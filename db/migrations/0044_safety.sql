-- Chunk 3S. Safety tests: one run per tap, one row per attack, fixes for the demo sample, the one time ownership
-- confirmation and canary hits. Members read their own workspace; every write goes through the functions below.

CREATE TABLE nazir.safety_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 started_by uuid NOT NULL,
 scope text NOT NULL CHECK (scope IN ('full','replies_only','sample')),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','stopped','paused')),
 canary text NOT NULL CHECK (canary ~ '^NZC-[0-9A-F]{8}$'),
 connection_revision text,
 agent_name text,
 errors_in_row int NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz,
 finished_at timestamptz,
 FOREIGN KEY(workspace_id,started_by) REFERENCES nazir.members(workspace_id,id)
);
CREATE UNIQUE INDEX safety_runs_canary ON nazir.safety_runs(canary);
CREATE INDEX safety_runs_active ON nazir.safety_runs(created_at) WHERE status IN ('queued','running');

CREATE TABLE nazir.safety_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 run_id uuid NOT NULL,
 position int NOT NULL,
 attack jsonb NOT NULL CHECK (jsonb_typeof(attack)='object'),
 family text NOT NULL CHECK (family ~ '^S[0-9]{1,2}$'),
 language text NOT NULL CHECK (language IN ('en','ar')),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done')),
 outcome text CHECK (outcome IN ('broken','partial','resisted','could_not_tell','not_run')),
 severity text CHECK (severity IN ('critical','high','medium','low')),
 proven text CHECK (proven IN ('trace','canary','reply')),
 reply text CHECK (char_length(reply)<=4000),
 did text CHECK (char_length(did)<=2000),
 note text,
 lease_until timestamptz,
 finished_at timestamptz,
 UNIQUE(run_id,position),
 FOREIGN KEY(workspace_id,run_id) REFERENCES nazir.safety_runs(workspace_id,id)
);

CREATE TABLE nazir.safety_fixes (
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 family text NOT NULL CHECK (family ~ '^S[0-9]{1,2}$'),
 approved_by uuid NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,family)
);

CREATE TABLE nazir.safety_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 member_id uuid NOT NULL,
 host text NOT NULL CHECK (char_length(host) BETWEEN 1 AND 255),
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE nazir.canary_hits (
 id bigserial PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 run_id uuid NOT NULL,
 at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['safety_runs','safety_attempts','safety_fixes','safety_confirmations','canary_hits'] LOOP
  EXECUTE format('ALTER TABLE nazir.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE nazir.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON nazir.%I FROM PUBLIC', t);
  EXECUTE format('CREATE POLICY safety_workspace_read ON nazir.%I FOR SELECT TO nazir_app,nazir_worker USING (workspace_id=nazir.current_workspace_id())', t);
  EXECUTE format('GRANT SELECT ON nazir.%I TO nazir_app,nazir_worker', t);
 END LOOP;
END $$;
CREATE POLICY safety_worker_update ON nazir.safety_runs FOR UPDATE TO nazir_worker USING (workspace_id=nazir.current_workspace_id()) WITH CHECK (workspace_id=nazir.current_workspace_id());
CREATE POLICY safety_worker_update ON nazir.safety_attempts FOR UPDATE TO nazir_worker USING (workspace_id=nazir.current_workspace_id()) WITH CHECK (workspace_id=nazir.current_workspace_id());
GRANT UPDATE(status,started_at,finished_at,errors_in_row) ON nazir.safety_runs TO nazir_worker;
GRANT UPDATE(status,outcome,severity,proven,reply,did,note,lease_until,finished_at) ON nazir.safety_attempts TO nazir_worker;

-- I own this agent or have written permission to test it. Logged once per workspace, with person, time and host.
CREATE FUNCTION nazir.safety_confirm(p_host text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NOT nazir.member_can_work() THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 INSERT INTO nazir.safety_confirmations(workspace_id,member_id,host) VALUES(nazir.current_workspace_id(),nazir.current_member_id(),left(btrim(p_host),255));
 PERFORM nazir.append_audit('safety.confirmed','workspace',nazir.current_workspace_id()::text,jsonb_build_object('host',left(btrim(p_host),255)));
END $$;

-- One safety test at a time per workspace, at most 2 a day (the shared demo: 6 an hour). Needs the confirmation first.
CREATE FUNCTION nazir.safety_start(p_scope text,p_canary text,p_revision text,p_agent_name text,p_attacks jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE wid uuid:=nazir.current_workspace_id(); rid uuid; a jsonb; i int:=0; demo boolean;
BEGIN
 IF NOT nazir.member_can_work() OR wid IS NULL THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('safety:'||wid::text,0));
 SELECT kind='demo' INTO demo FROM nazir.workspaces WHERE id=wid;
 IF NOT demo AND NOT EXISTS(SELECT FROM nazir.safety_confirmations WHERE workspace_id=wid) THEN RAISE EXCEPTION 'safety_confirm_needed'; END IF;
 SELECT id INTO rid FROM nazir.safety_runs WHERE workspace_id=wid AND status IN ('queued','running') LIMIT 1;
 IF rid IS NOT NULL THEN RETURN rid; END IF;
 IF (demo AND (SELECT count(*) FROM nazir.safety_runs WHERE workspace_id=wid AND created_at>clock_timestamp()-interval '1 hour')>=6)
  OR (NOT demo AND (SELECT count(*) FROM nazir.safety_runs WHERE workspace_id=wid AND created_at>clock_timestamp()-interval '1 day')>=2) THEN RAISE EXCEPTION 'safety_daily_limit'; END IF;
 IF jsonb_typeof(p_attacks)<>'array' OR jsonb_array_length(p_attacks) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Invalid attacks'; END IF;
 INSERT INTO nazir.safety_runs(workspace_id,started_by,scope,canary,connection_revision,agent_name) VALUES(wid,nazir.current_member_id(),p_scope,p_canary,p_revision,left(p_agent_name,80)) RETURNING id INTO rid;
 FOR a IN SELECT * FROM jsonb_array_elements(p_attacks) LOOP
  i:=i+1;
  INSERT INTO nazir.safety_attempts(workspace_id,run_id,position,attack,family,language,status,outcome)
   VALUES(wid,rid,i,a,a->>'family',a->>'language',CASE WHEN a ? 'needs' THEN 'done' ELSE 'queued' END,CASE WHEN a ? 'needs' THEN 'not_run' END);
 END LOOP;
 PERFORM nazir.append_audit('safety.started','safety_run',rid::text,jsonb_build_object('scope',p_scope,'attacks',i));
 RETURN rid;
END $$;

CREATE FUNCTION nazir.safety_stop(p_run uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NOT nazir.member_can_work() THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 UPDATE nazir.safety_runs SET status='stopped',finished_at=clock_timestamp() WHERE id=p_run AND workspace_id=nazir.current_workspace_id() AND status IN ('queued','running','paused');
 IF FOUND THEN
  UPDATE nazir.safety_attempts SET status='done',outcome='not_run',lease_until=NULL WHERE run_id=p_run AND status IN ('queued','running');
  PERFORM nazir.append_audit('safety.stopped','safety_run',p_run::text,'{}');
 END IF;
END $$;

-- The demo sample's fixes, approved in Nazir. Your own agent is changed by you, then tested again.
-- The demo is shared, so a fix counts for one hour; the next visitor meets the planted weaknesses again.
CREATE FUNCTION nazir.safety_fix_approve(p_family text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NOT nazir.member_can_work() THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF p_family !~ '^S[0-9]{1,2}$' THEN RAISE EXCEPTION 'Invalid family'; END IF;
 IF NOT EXISTS(SELECT FROM nazir.workspaces WHERE id=nazir.current_workspace_id() AND kind='demo') THEN RAISE EXCEPTION 'Only the sample agent can be fixed in Nazir'; END IF;
 INSERT INTO nazir.safety_fixes(workspace_id,family,approved_by) VALUES(nazir.current_workspace_id(),p_family,nazir.current_member_id())
  ON CONFLICT(workspace_id,family) DO UPDATE SET approved_by=excluded.approved_by,approved_at=clock_timestamp();
 PERFORM nazir.append_audit('safety.fix_approved','workspace',nazir.current_workspace_id()::text,jsonb_build_object('family',p_family));
END $$;

-- Every workspace's waiting safety tests, oldest first. Worker only.
CREATE FUNCTION nazir.safety_pending() RETURNS TABLE(run_id uuid,workspace_id uuid,started_by uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'nazir_worker' THEN RAISE EXCEPTION 'Worker required'; END IF;
 RETURN QUERY SELECT r.id,r.workspace_id,r.started_by FROM nazir.safety_runs r WHERE r.status IN ('queued','running') ORDER BY r.created_at LIMIT 20;
END $$;

-- The canary sink: a hit proves data left the agent. It records the hit only and returns nothing.
CREATE FUNCTION nazir.safety_canary_hit(p_canary text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE r record;
BEGIN
 SELECT id,workspace_id INTO r FROM nazir.safety_runs WHERE canary=upper(p_canary) AND created_at>clock_timestamp()-interval '7 days';
 IF NOT FOUND THEN RETURN; END IF;
 IF (SELECT count(*) FROM nazir.canary_hits WHERE run_id=r.id)>=50 THEN RETURN; END IF;
 INSERT INTO nazir.canary_hits(workspace_id,run_id) VALUES(r.workspace_id,r.id);
END $$;

REVOKE ALL ON FUNCTION nazir.safety_confirm(text), nazir.safety_start(text,text,text,text,jsonb), nazir.safety_stop(uuid), nazir.safety_fix_approve(text), nazir.safety_pending(), nazir.safety_canary_hit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.safety_confirm(text), nazir.safety_start(text,text,text,text,jsonb), nazir.safety_stop(uuid), nazir.safety_fix_approve(text) TO nazir_app;
GRANT EXECUTE ON FUNCTION nazir.safety_pending() TO nazir_worker;
GRANT EXECUTE ON FUNCTION nazir.safety_canary_hit(text) TO nazir_ingest;
