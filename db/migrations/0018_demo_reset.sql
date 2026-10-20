-- N24 demo reset: capped recyclable storage for demo workspaces. Sign in tables are not referenced.
CREATE TABLE nazir.demo_store (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 bytes int NOT NULL CHECK(bytes>0)
);
CREATE INDEX ON nazir.demo_store(workspace_id,created_at,id);
CREATE TABLE nazir.demo_reset_log (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 reason text NOT NULL CHECK(reason IN ('schedule','on_demand')),
 removed int NOT NULL CHECK(removed>=0),
 cap_bytes int NOT NULL CHECK(cap_bytes>0)
);
CREATE INDEX ON nazir.demo_reset_log(workspace_id,created_at);
ALTER TABLE nazir.demo_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.demo_store FORCE ROW LEVEL SECURITY;
ALTER TABLE nazir.demo_reset_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.demo_reset_log FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace ON nazir.demo_store TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
CREATE POLICY workspace ON nazir.demo_reset_log TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
CREATE POLICY demo_store_write ON nazir.demo_store AS RESTRICTIVE FOR INSERT TO nazir_app
 WITH CHECK(nazir.member_has_role('service_owner') AND EXISTS(SELECT 1 FROM nazir.workspaces w WHERE w.id=nazir.current_workspace_id() AND w.kind='demo'));
GRANT SELECT,INSERT ON nazir.demo_store TO nazir_app;
GRANT SELECT ON nazir.demo_store TO nazir_worker;
GRANT SELECT ON nazir.demo_reset_log TO nazir_app,nazir_worker;
CREATE FUNCTION nazir.demo_store_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE kind text;
BEGIN
 SELECT w.kind INTO kind FROM nazir.workspaces w WHERE w.id=NEW.workspace_id;
 IF kind IS DISTINCT FROM 'demo' THEN RAISE EXCEPTION 'This workspace is not a demo'; END IF;
 NEW.bytes:=octet_length(NEW.payload::text);
 IF NEW.bytes IS NULL OR NEW.bytes<1 THEN RAISE EXCEPTION 'Demo storage needs a payload'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.demo_store_guard() FROM PUBLIC;
CREATE TRIGGER demo_store_guard BEFORE INSERT ON nazir.demo_store FOR EACH ROW EXECUTE FUNCTION nazir.demo_store_guard();
CREATE FUNCTION nazir.demo_log_frozen() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN RAISE EXCEPTION 'Reset history cannot change'; END $$;
REVOKE ALL ON FUNCTION nazir.demo_log_frozen() FROM PUBLIC;
CREATE TRIGGER demo_log_frozen BEFORE UPDATE OR DELETE ON nazir.demo_reset_log FOR EACH ROW EXECUTE FUNCTION nazir.demo_log_frozen();
CREATE TRIGGER demo_log_no_truncate BEFORE TRUNCATE ON nazir.demo_reset_log FOR EACH STATEMENT EXECUTE FUNCTION nazir.demo_log_frozen();
CREATE FUNCTION nazir.demo_workspace_ids() RETURNS TABLE(id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT w.id FROM nazir.workspaces w WHERE w.kind='demo'
$$;
REVOKE ALL ON FUNCTION nazir.demo_workspace_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.demo_workspace_ids() TO nazir_worker;
-- Recycles the oldest demo rows until the workspace is within the byte cap.
-- A scheduled call does nothing when one already finished within 6 hours.
-- Row locks use SKIP LOCKED and a short lock timeout, and this function never opens sign in tables.
CREATE FUNCTION nazir.demo_recycle(p_workspace uuid,p_cap integer,p_reason text,p_now timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE
 removed integer:=0; used integer; kind text; store_id uuid; store_at timestamptz; message_id uuid; message_at timestamptz;
BEGIN
 IF p_cap IS NULL OR p_cap<1 OR p_cap>100000000 THEN RAISE EXCEPTION 'Invalid storage cap'; END IF;
 IF p_reason IS NULL OR p_reason NOT IN ('schedule','on_demand') THEN RAISE EXCEPTION 'Invalid reset reason'; END IF;
 IF p_now IS NULL THEN p_now:=clock_timestamp(); END IF;
 IF current_setting('role',true) IN ('nazir_app','nazir_worker') AND p_workspace IS DISTINCT FROM nazir.current_workspace_id() THEN
  RAISE EXCEPTION 'Workspace context required';
 END IF;
 SELECT w.kind INTO kind FROM nazir.workspaces w WHERE w.id=p_workspace;
 IF kind IS DISTINCT FROM 'demo' THEN RAISE EXCEPTION 'This workspace is not a demo'; END IF;
 IF p_reason='schedule' AND EXISTS(SELECT 1 FROM nazir.demo_reset_log l WHERE l.workspace_id=p_workspace AND l.reason='schedule' AND l.created_at>p_now-interval '6 hours') THEN
  RETURN 0;
 END IF;
 PERFORM set_config('lock_timeout','200ms',true);
 LOOP
  SELECT coalesce(sum(s.bytes),0)+coalesce((SELECT sum(octet_length(m.body)) FROM nazir.agent_messages m WHERE m.workspace_id=p_workspace),0)
   INTO used FROM nazir.demo_store s WHERE s.workspace_id=p_workspace;
  EXIT WHEN used<=p_cap;
  store_id:=NULL; message_id:=NULL;
  SELECT s.id,s.created_at INTO store_id,store_at FROM nazir.demo_store s WHERE s.workspace_id=p_workspace ORDER BY s.created_at,s.id FOR UPDATE SKIP LOCKED LIMIT 1;
  SELECT m.id,m.created_at INTO message_id,message_at FROM nazir.agent_messages m WHERE m.workspace_id=p_workspace ORDER BY m.created_at,m.id FOR UPDATE SKIP LOCKED LIMIT 1;
  EXIT WHEN store_id IS NULL AND message_id IS NULL;
  IF message_id IS NULL OR (store_id IS NOT NULL AND (store_at,store_id)<=(message_at,message_id)) THEN
   DELETE FROM nazir.demo_store WHERE id=store_id;
  ELSE
   DELETE FROM nazir.agent_messages WHERE id=message_id;
  END IF;
  removed:=removed+1;
 END LOOP;
 DELETE FROM nazir.agent_threads t WHERE t.workspace_id=p_workspace AND NOT EXISTS(SELECT 1 FROM nazir.agent_messages m WHERE m.thread_id=t.id AND m.workspace_id=t.workspace_id);
 INSERT INTO nazir.demo_reset_log(workspace_id,reason,removed,cap_bytes) VALUES(p_workspace,p_reason,removed,p_cap);
 IF current_setting('role',true) IN ('nazir_app','nazir_worker') THEN
  PERFORM nazir.append_audit('demo.reset','workspace',p_workspace::text,jsonb_build_object('reason',p_reason,'removed',removed,'cap_bytes',p_cap));
 END IF;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION nazir.demo_recycle(uuid,integer,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.demo_recycle(uuid,integer,text,timestamptz) TO nazir_app,nazir_worker;
