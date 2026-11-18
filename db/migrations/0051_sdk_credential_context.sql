-- Safety sessions carry their actual run and question. Existing unbound sessions cannot upload security traces.
CREATE OR REPLACE FUNCTION nazir.open_test_session(p_mode text, p_run uuid DEFAULT NULL, p_conversation uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE sid text;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (current_setting('role',true)='nazir_worker' OR nazir.member_can_work()) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF p_mode NOT IN ('quality','security','connect') THEN RAISE EXCEPTION 'Invalid mode'; END IF;
 IF p_mode='security' AND p_run IS NOT NULL THEN
  IF current_setting('role',true)<>'nazir_worker' OR NOT EXISTS(
   SELECT FROM nazir.safety_runs r JOIN nazir.safety_attempts a ON a.run_id=r.id AND a.workspace_id=r.workspace_id
   WHERE r.id=p_run AND r.workspace_id=nazir.current_workspace_id() AND r.status IN ('queued','running') AND a.id=p_conversation AND a.status='running'
  ) THEN RAISE EXCEPTION 'Invalid safety question'; END IF;
 ELSIF p_run IS NOT NULL AND NOT EXISTS(SELECT FROM nazir.runs WHERE id=p_run AND workspace_id=nazir.current_workspace_id()) THEN RAISE EXCEPTION 'Invalid run'; END IF;
 sid := 'ses_' || replace(gen_random_uuid()::text,'-','');
 INSERT INTO nazir.test_sessions(id,workspace_id,run_id,conversation_id,mode,connection_revision) VALUES(sid,nazir.current_workspace_id(),p_run,p_conversation,p_mode,(SELECT revision FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id()));
 RETURN sid;
END $$;

-- Only the server ingest role receives encrypted context, after validating the real key and session.
-- Locks last through decryption, scrubbing and INSERT in the SAME transaction. Credential removal,
-- connection changes and run cleanup either finish first (upload rejected), or wait for safe storage.
CREATE FUNCTION nazir.sdk_trace_context(p_hash text,p_session text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE k nazir.sdk_keys; s nazir.test_sessions; a nazir.external_agents; people text; family text;
BEGIN
 SELECT * INTO k FROM nazir.sdk_keys WHERE key_hash=p_hash AND revoked_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'sdk_key'; END IF;
 SELECT * INTO s FROM nazir.test_sessions WHERE id=p_session FOR UPDATE;
 IF NOT FOUND OR s.workspace_id<>k.workspace_id OR s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'sdk_session'; END IF;
 SELECT * INTO a FROM nazir.external_agents WHERE workspace_id=k.workspace_id FOR UPDATE;
 IF NOT FOUND OR a.revision IS DISTINCT FROM s.connection_revision THEN RAISE EXCEPTION 'sdk_session'; END IF;
 IF s.mode='security' THEN
  SELECT q.family INTO family FROM nazir.safety_attempts q JOIN nazir.safety_runs r ON r.id=q.run_id AND r.workspace_id=q.workspace_id
  WHERE q.id=s.conversation_id AND r.id=s.run_id AND r.workspace_id=k.workspace_id
  AND r.status IN ('queued','running') AND q.status='running' AND r.connection_revision=a.revision::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'sdk_session'; END IF;
  IF family='S10' THEN
   SELECT cipher INTO people FROM nazir.safety_run_people WHERE workspace_id=k.workspace_id AND run_id=s.run_id FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'sdk_session'; END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('connection',a.key_cipher,'people',people);
END $$;
REVOKE ALL ON FUNCTION nazir.sdk_trace_context(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.sdk_trace_context(text,text) TO nazir_ingest;

-- Keep the existing storage implementation private behind the lifecycle guard, including direct role calls.
ALTER FUNCTION nazir.ingest_spans(text,text,jsonb,text) RENAME TO store_sdk_spans;
REVOKE ALL ON FUNCTION nazir.store_sdk_spans(text,text,jsonb,text) FROM PUBLIC,nazir_ingest;
CREATE FUNCTION nazir.ingest_spans(p_hash text,p_session text,p_spans jsonb,p_sdk_version text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 PERFORM nazir.sdk_trace_context(p_hash,p_session);
 RETURN nazir.store_sdk_spans(p_hash,p_session,p_spans,p_sdk_version);
END $$;
REVOKE ALL ON FUNCTION nazir.ingest_spans(text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.ingest_spans(text,text,jsonb,text) TO nazir_ingest;
