ALTER TABLE nazir.runs DROP CONSTRAINT runs_status_check;
ALTER TABLE nazir.conversations DROP CONSTRAINT conversations_status_check;
ALTER TABLE nazir.runs ADD CHECK(status IN ('planned','queued','running','passed','failed','inconclusive','cancelled'));
ALTER TABLE nazir.conversations ADD CHECK(status IN ('planned','queued','running','passed','failed','inconclusive','cancelled'));
ALTER TABLE nazir.runs ADD COLUMN idempotency_key text, ADD COLUMN calls_budget int CHECK(calls_budget>0), ADD UNIQUE(workspace_id,idempotency_key);
UPDATE nazir.runs r SET calls_budget=p.budget_calls FROM nazir.plans p WHERE p.id=r.plan_id AND p.workspace_id=r.workspace_id;
ALTER TABLE nazir.runs ALTER COLUMN calls_budget SET NOT NULL;
ALTER TABLE nazir.conversations
 ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN max_attempts int NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 5),
 ADD COLUMN last_error text CHECK(last_error ~ '^[a-z][a-z0-9_]{0,63}$'),
 ADD COLUMN heartbeat_at timestamptz,
 ADD COLUMN agent_version_id uuid,
 ADD COLUMN scenario_hash text,
 ADD COLUMN result_summary jsonb,
 ADD FOREIGN KEY(workspace_id,agent_version_id) REFERENCES nazir.agent_versions(workspace_id,id);
ALTER TABLE nazir.conversation_messages ADD COLUMN attempt int NOT NULL DEFAULT 1 CHECK(attempt>0);
ALTER TABLE nazir.tool_events ADD COLUMN attempt int NOT NULL DEFAULT 1 CHECK(attempt>0);
ALTER TABLE nazir.state_readings ADD COLUMN attempt int NOT NULL DEFAULT 1 CHECK(attempt>0);
CREATE INDEX runner_ready ON nazir.conversations(available_at,created_at,id) WHERE status IN ('queued','running');
CREATE FUNCTION nazir.runner_state() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF TG_OP='INSERT' AND TG_TABLE_NAME='runs' THEN
  IF NEW.calls_budget IS NULL THEN SELECT budget_calls INTO NEW.calls_budget FROM nazir.plans WHERE id=NEW.plan_id AND workspace_id=NEW.workspace_id; END IF;
 END IF;
 IF NEW.status='inconclusive' AND coalesce(btrim(NEW.inconclusive_reason),'')='' THEN RAISE EXCEPTION 'Reason required'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status IN ('passed','failed','inconclusive','cancelled') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Final record is immutable'; END IF;
  IF NEW.status<>OLD.status AND NOT (
   (OLD.status='planned' AND NEW.status IN ('queued','cancelled')) OR
   (OLD.status='queued' AND NEW.status IN ('running','cancelled')) OR
   (OLD.status='running' AND NEW.status IN ('queued','passed','failed','inconclusive','cancelled'))
  ) THEN RAISE EXCEPTION 'State transition refused'; END IF;
  IF TG_TABLE_NAME='conversations' THEN
   IF OLD.result_summary IS NOT NULL AND NEW.result_summary IS DISTINCT FROM OLD.result_summary THEN RAISE EXCEPTION 'Result is immutable'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER runner_state BEFORE INSERT OR UPDATE ON nazir.runs FOR EACH ROW EXECUTE FUNCTION nazir.runner_state();
CREATE TRIGGER runner_state BEFORE INSERT OR UPDATE ON nazir.conversations FOR EACH ROW EXECUTE FUNCTION nazir.runner_state();
REVOKE ALL ON FUNCTION nazir.runner_state() FROM PUBLIC;

-- Called with workspace context by the worker or by the cross-workspace claim.
CREATE FUNCTION nazir.runner_aggregate(p_run uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
DECLARE r nazir.runs; n int; bad int; uncertain int; next_status text;
BEGIN
 SELECT * INTO r FROM nazir.runs WHERE id=p_run AND workspace_id=nazir.current_workspace_id() FOR UPDATE;
 IF NOT FOUND OR r.status IN ('passed','failed','inconclusive','cancelled') THEN RETURN; END IF;
 SELECT count(*),count(*) FILTER(WHERE status='failed'),count(*) FILTER(WHERE status='inconclusive') INTO n,bad,uncertain FROM nazir.conversations WHERE run_id=p_run;
 IF n=0 OR EXISTS(SELECT FROM nazir.conversations WHERE run_id=p_run AND status NOT IN ('passed','failed','inconclusive','cancelled')) THEN RETURN; END IF;
 next_status:=CASE WHEN bad>0 THEN 'failed' WHEN uncertain>0 THEN 'inconclusive' WHEN EXISTS(SELECT FROM nazir.conversations WHERE run_id=p_run AND status='cancelled') THEN 'cancelled' ELSE 'passed' END;
 UPDATE nazir.runs SET status=next_status,finished_at=clock_timestamp(),inconclusive_reason=CASE WHEN next_status='inconclusive' THEN 'conversations_'||uncertain END WHERE id=p_run;
 PERFORM nazir.append_audit('run_finished','run',p_run::text,jsonb_build_object('status',next_status));
END $$;
REVOKE ALL ON FUNCTION nazir.runner_aggregate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.runner_aggregate(uuid) TO nazir_worker;
CREATE FUNCTION nazir.runner_claim(p_worker text,p_lease_seconds int)
RETURNS TABLE(workspace_id uuid,conversation_id uuid,run_id uuid,attempt int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE c nazir.conversations; previous_context text; recovered boolean; a int;
BEGIN
 IF current_setting('role',true)<>'nazir_worker' OR p_worker IS NULL OR p_worker !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900 THEN RAISE EXCEPTION 'Invalid claim'; END IF;
 previous_context:=current_setting('app.workspace_id',true);
 LOOP
  SELECT q.* INTO c FROM nazir.conversations q JOIN nazir.runs r ON r.id=q.run_id
  WHERE r.status IN ('queued','running') AND ((q.status='queued' AND q.available_at<=clock_timestamp()) OR (q.status='running' AND q.lease_expires_at<=clock_timestamp()))
  ORDER BY q.created_at,q.id FOR UPDATE OF r,q SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN EXIT; END IF;
  PERFORM set_config('app.workspace_id',c.workspace_id::text,true);
  recovered:=c.status='running';
  IF recovered AND c.attempt>=c.max_attempts THEN
   UPDATE nazir.conversations SET status='inconclusive',inconclusive_reason='lease_expired',last_error='lease_expired',finished_at=clock_timestamp(),result_summary='{}',lease_owner=NULL,lease_expires_at=NULL WHERE id=c.id;
   PERFORM nazir.append_audit('conversation_finished','conversation',c.id::text,jsonb_build_object('status','inconclusive','reason','lease_expired','attempt',c.attempt,'provider',c.model_provider,'model',c.model_id,'failover',c.failover));
   PERFORM nazir.runner_aggregate(c.run_id);
   CONTINUE;
  END IF;
  a:=c.attempt+CASE WHEN c.sandbox_tenant IS NOT NULL THEN 1 ELSE 0 END;
  UPDATE nazir.conversations SET status='running',attempt=a,lease_owner=p_worker,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),heartbeat_at=clock_timestamp(),sandbox_tenant='r_'||replace(c.id::text,'-','')||'_'||a,started_at=coalesce(started_at,clock_timestamp()) WHERE id=c.id;
  UPDATE nazir.runs SET status='running',started_at=coalesce(started_at,clock_timestamp()) WHERE id=c.run_id AND status='queued';
  IF FOUND THEN PERFORM nazir.append_audit('run_started','run',c.run_id::text,'{}'); END IF;
  IF recovered THEN PERFORM nazir.append_audit('lease_recovered','conversation',c.id::text,jsonb_build_object('attempt',a)); END IF;
  PERFORM nazir.append_audit('conversation_claimed','conversation',c.id::text,jsonb_build_object('run_id',c.run_id,'attempt',a));
  workspace_id:=c.workspace_id; conversation_id:=c.id; run_id:=c.run_id; attempt:=a;
  PERFORM set_config('app.workspace_id',coalesce(previous_context,''),true);
  RETURN NEXT; RETURN;
 END LOOP;
 PERFORM set_config('app.workspace_id',coalesce(previous_context,''),true);
END $$;
CREATE FUNCTION nazir.runner_heartbeat(p_conversation uuid,p_worker text,p_attempt int,p_lease_seconds int) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true)<>'nazir_worker' OR p_worker IS NULL OR p_worker !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900 THEN RAISE EXCEPTION 'Invalid heartbeat'; END IF;
 UPDATE nazir.conversations SET heartbeat_at=clock_timestamp(),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
 WHERE id=p_conversation AND lease_owner=p_worker AND attempt=p_attempt AND status='running' AND lease_expires_at>clock_timestamp();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION nazir.runner_claim(text,int),nazir.runner_heartbeat(uuid,text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.runner_claim(text,int),nazir.runner_heartbeat(uuid,text,int,int) TO nazir_worker;

-- Exact registry references bind to the pinned executable configuration.
-- All other configurations retain the existing content hash behavior.
CREATE FUNCTION nazir.runner_registry_hash() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NEW.config = jsonb_build_object('registry_id',NEW.config->>'registry_id') THEN
 IF NEW.config->>'registry_id' IN ('baseline','planted_wrong_queue','planted_false_submit') AND NEW.kind <> (CASE WHEN NEW.config->>'registry_id'='baseline' THEN 'baseline' ELSE 'planted_fault' END) THEN RAISE EXCEPTION 'Registry kind mismatch'; END IF;
 NEW.config_hash:=CASE NEW.config->>'registry_id' WHEN 'baseline' THEN '4df0877a050cf1413a3e62057caa402821264a52fcd0b961afceaf091110a412'
WHEN 'planted_wrong_queue' THEN 'dd6beb258d1f0c7482b23d35c1becf372185e2bf757b9ec82ed3988428128193'
WHEN 'planted_false_submit' THEN 'ffc35a6bbbbc3a64c7947b604de88c90e0f838306b09c98a101a4aac162f1909' ELSE NEW.config_hash END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_runner_registry_hash BEFORE INSERT OR UPDATE ON nazir.agent_versions FOR EACH ROW EXECUTE FUNCTION nazir.runner_registry_hash();
REVOKE ALL ON FUNCTION nazir.runner_registry_hash() FROM PUBLIC;

-- Canonical JSON for runner manifests only; other content hashes retain their format.
CREATE FUNCTION nazir.runner_canonical(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,nazir AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||nazir.runner_canonical(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(nazir.runner_canonical(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ord);
 ELSE result:=v::text;
 END CASE;
 RETURN result;
END $$;
CREATE FUNCTION nazir.runner_manifest_hash() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NEW.runner_version='n10' THEN NEW.manifest_hash:=encode(sha256(convert_to(nazir.runner_canonical(NEW.frozen_manifest),'UTF8')),'hex'); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_runner_manifest_hash BEFORE INSERT OR UPDATE ON nazir.runs FOR EACH ROW EXECUTE FUNCTION nazir.runner_manifest_hash();
REVOKE ALL ON FUNCTION nazir.runner_canonical(jsonb),nazir.runner_manifest_hash() FROM PUBLIC;
-- Triggers run with the invoking role, so only workers need this pure helper.
GRANT EXECUTE ON FUNCTION nazir.runner_canonical(jsonb) TO nazir_worker;
CREATE FUNCTION nazir.runner_fixture_workspace() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT id FROM nazir.workspaces WHERE name='Nazir runner fixture' ORDER BY created_at,id LIMIT 1
$$;
REVOKE ALL ON FUNCTION nazir.runner_fixture_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.runner_fixture_workspace() TO nazir_worker;
ALTER TABLE nazir.conversations ADD COLUMN model_calls jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(model_calls)='array');
-- The event key identifies an invocation; the tool key identifies the sandbox action.
ALTER TABLE nazir.tool_events ADD COLUMN tool_idempotency_key text;
