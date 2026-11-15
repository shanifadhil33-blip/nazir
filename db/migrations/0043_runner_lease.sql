-- The background runner lock is a short lease row, not a session advisory lock. Through the transaction pooler an
-- advisory unlock can land on another server session, so the lock leaked and every later tick saw "busy" until the
-- pooler recycled that session. Checks then sat queued. A lease expires on its own if a tick dies.

CREATE TABLE nazir.runner_lease (
 id smallint PRIMARY KEY CHECK (id=1),
 holder text,
 expires_at timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO nazir.runner_lease(id) VALUES(1);
-- Like the AI cooldowns: no policies, no grants. Only the two functions below touch it.
ALTER TABLE nazir.runner_lease ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.runner_lease FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nazir.runner_lease FROM PUBLIC,nazir_app,nazir_worker,nazir_sandbox,nazir_inspector;

-- Take or renew the lease. The same holder renews; anyone takes it once it has expired.
CREATE FUNCTION nazir.runner_lease_take(p_holder text,p_seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE ok boolean;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'nazir_worker' THEN RAISE EXCEPTION 'Worker required'; END IF;
 IF p_holder IS NULL OR length(p_holder) NOT BETWEEN 8 AND 100 OR p_seconds IS NULL OR p_seconds NOT BETWEEN 5 AND 600 THEN RAISE EXCEPTION 'Invalid lease'; END IF;
 UPDATE nazir.runner_lease SET holder=p_holder,expires_at=clock_timestamp()+make_interval(secs=>p_seconds)
  WHERE id=1 AND (expires_at<clock_timestamp() OR holder=p_holder) RETURNING true INTO ok;
 RETURN coalesce(ok,false);
END $$;

CREATE FUNCTION nazir.runner_lease_release(p_holder text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE ok boolean;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'nazir_worker' THEN RAISE EXCEPTION 'Worker required'; END IF;
 UPDATE nazir.runner_lease SET holder=NULL,expires_at='-infinity' WHERE id=1 AND holder=p_holder RETURNING true INTO ok;
 RETURN coalesce(ok,false);
END $$;

REVOKE ALL ON FUNCTION nazir.runner_lease_take(text,integer) FROM PUBLIC,nazir_app,nazir_auth;
REVOKE ALL ON FUNCTION nazir.runner_lease_release(text) FROM PUBLIC,nazir_app,nazir_auth;
GRANT EXECUTE ON FUNCTION nazir.runner_lease_take(text,integer) TO nazir_worker;
GRANT EXECUTE ON FUNCTION nazir.runner_lease_release(text) TO nazir_worker;
