-- Ownership follows the exact connection and SDK session. Old confirmations need renewal.
ALTER TABLE nazir.test_sessions ADD COLUMN connection_revision uuid;
ALTER TABLE nazir.external_agents ADD COLUMN sdk_revision uuid, ADD COLUMN sdk_key_id uuid REFERENCES nazir.sdk_keys(id);
ALTER TABLE nazir.safety_confirmations ADD COLUMN connection_revision uuid, ADD COLUMN proof_method text CHECK (proof_method IN ('sdk','domain'));

CREATE OR REPLACE FUNCTION nazir.open_test_session(p_mode text, p_run uuid DEFAULT NULL, p_conversation uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE sid text;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (current_setting('role',true)='nazir_worker' OR nazir.member_can_work()) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF p_mode NOT IN ('quality','security','connect') THEN RAISE EXCEPTION 'Invalid mode'; END IF;
 IF p_run IS NOT NULL AND NOT EXISTS(SELECT 1 FROM nazir.runs WHERE id=p_run AND workspace_id=nazir.current_workspace_id()) THEN RAISE EXCEPTION 'Invalid run'; END IF;
 sid := 'ses_' || replace(gen_random_uuid()::text,'-','');
 INSERT INTO nazir.test_sessions(id,workspace_id,run_id,conversation_id,mode,connection_revision) VALUES(sid,nazir.current_workspace_id(),p_run,p_conversation,p_mode,(SELECT revision FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id()));
 RETURN sid;
END $$;

CREATE OR REPLACE FUNCTION nazir.ingest_spans(p_hash text, p_session text, p_spans jsonb, p_sdk_version text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE k nazir.sdk_keys; s nazir.test_sessions; n int; recent int; hello boolean;
BEGIN
 IF jsonb_typeof(p_spans)<>'array' OR jsonb_array_length(p_spans) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'sdk_invalid'; END IF;
 SELECT * INTO k FROM nazir.sdk_keys WHERE key_hash=p_hash AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'sdk_key'; END IF;
 SELECT * INTO s FROM nazir.test_sessions WHERE id=p_session FOR UPDATE;
 IF NOT FOUND OR s.workspace_id<>k.workspace_id OR s.expires_at<clock_timestamp() THEN RAISE EXCEPTION 'sdk_session'; END IF;
 n := jsonb_array_length(p_spans);
 IF s.span_count+n>500 THEN RAISE EXCEPTION 'sdk_limit'; END IF;
 SELECT count(*) INTO recent FROM nazir.trace_spans WHERE workspace_id=k.workspace_id AND received_at>clock_timestamp()-interval '1 hour';
 IF recent+n>5000 THEN RAISE EXCEPTION 'sdk_limit'; END IF;
 INSERT INTO nazir.trace_spans(workspace_id,session_id,turn,trace_id,span_id,parent_span_id,kind,name,started_at,ended_at,status,attributes)
 SELECT k.workspace_id,s.id,(x->>'turn')::int,x->>'trace_id',x->>'span_id',x->>'parent_span_id',x->>'kind',x->>'name',(x->>'start')::timestamptz,(x->>'end')::timestamptz,coalesce(x->>'status','OK'),coalesce(x->'attributes','{}')
 FROM jsonb_array_elements(p_spans) x;
 hello := EXISTS(SELECT 1 FROM jsonb_array_elements(p_spans) x WHERE x->>'kind'='nazir.hello');
 UPDATE nazir.test_sessions SET span_count=span_count+n, hello_at=CASE WHEN hello THEN coalesce(hello_at,clock_timestamp()) ELSE hello_at END WHERE id=s.id;
 UPDATE nazir.sdk_keys SET last_used_at=clock_timestamp() WHERE id=k.id;
 IF hello THEN
  UPDATE nazir.external_agents SET sdk_seen_at=clock_timestamp(), sdk_version=left(p_sdk_version,40), connection_kind='sdk',sdk_revision=s.connection_revision,sdk_key_id=k.id WHERE workspace_id=k.workspace_id AND revision=s.connection_revision;
 END IF;
 RETURN n;
END $$;

CREATE FUNCTION nazir.safety_sdk_fresh(p_revision uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT EXISTS(SELECT FROM nazir.external_agents a JOIN nazir.sdk_keys k ON k.id=a.sdk_key_id AND k.workspace_id=a.workspace_id AND k.revoked_at IS NULL
 WHERE a.workspace_id=nazir.current_workspace_id() AND a.revision=p_revision AND a.sdk_revision=a.revision AND a.connection_kind='sdk' AND a.sdk_seen_at>clock_timestamp()-interval '24 hours');
$$;

CREATE FUNCTION nazir.safety_is_confirmed(p_revision uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT EXISTS(SELECT FROM nazir.safety_confirmations c JOIN nazir.external_agents a ON a.workspace_id=c.workspace_id AND a.revision=c.connection_revision
 WHERE c.workspace_id=nazir.current_workspace_id() AND a.revision=p_revision AND a.tested_at IS NOT NULL
 AND c.host=substring(a.endpoint from '^https://([^/:?#]+)')
 AND ((c.proof_method='domain' AND c.confirmed_at>clock_timestamp()-interval '24 hours') OR (c.proof_method='sdk' AND nazir.safety_sdk_fresh(a.revision))));
$$;

-- Compatibility entry refuses unchecked historical clients until the new server is deployed.
CREATE OR REPLACE FUNCTION nazir.safety_confirm(p_host text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN RAISE EXCEPTION 'safety_confirm_needed'; END $$;
CREATE FUNCTION nazir.safety_confirm(p_revision uuid,p_method text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE a nazir.external_agents; h text;
BEGIN
 IF NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 SELECT * INTO a FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id() FOR SHARE;
 IF NOT FOUND OR a.revision IS DISTINCT FROM p_revision OR a.tested_at IS NULL THEN RAISE EXCEPTION 'safety_connection_changed'; END IF;
 IF p_method IS NULL OR p_method NOT IN ('sdk','domain') OR (p_method='sdk' AND NOT nazir.safety_sdk_fresh(a.revision)) THEN RAISE EXCEPTION 'safety_sdk_needed'; END IF;
 h:=substring(a.endpoint from '^https://([^/:?#]+)');
 INSERT INTO nazir.safety_confirmations(workspace_id,member_id,host,connection_revision,proof_method) VALUES(nazir.current_workspace_id(),nazir.current_member_id(),h,a.revision,p_method);
 PERFORM nazir.append_audit('safety.confirmed','workspace',nazir.current_workspace_id()::text,jsonb_build_object('host',h,'method',p_method,'revision',a.revision));
END $$;

CREATE FUNCTION nazir.safety_next_at() RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 WITH setting AS (SELECT kind='demo' AS demo FROM nazir.workspaces WHERE id=nazir.current_workspace_id()), recent AS (
 SELECT r.created_at,s.demo FROM nazir.safety_runs r CROSS JOIN setting s WHERE r.workspace_id=nazir.current_workspace_id()
 AND r.created_at>clock_timestamp()-CASE WHEN s.demo THEN interval '1 hour' ELSE interval '1 day' END ORDER BY r.created_at DESC LIMIT 2)
 SELECT CASE WHEN count(*)>=CASE WHEN bool_or(demo) THEN 1 ELSE 2 END THEN CASE WHEN bool_or(demo) THEN max(created_at) ELSE min(created_at) END+CASE WHEN bool_or(demo) THEN interval '1 hour' ELSE interval '1 day' END END FROM recent;
$$;

CREATE OR REPLACE FUNCTION nazir.safety_start(p_scope text,p_canary text,p_revision text,p_agent_name text,p_attacks jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE wid uuid:=nazir.current_workspace_id(); rid uuid; a jsonb; i int:=0; demo boolean;
BEGIN
 IF NOT nazir.member_can_work() OR wid IS NULL THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('safety:'||wid::text,0));
 SELECT kind='demo' INTO demo FROM nazir.workspaces WHERE id=wid;
 IF NOT demo THEN
  PERFORM 1 FROM nazir.external_agents WHERE workspace_id=wid FOR SHARE;
  IF NOT nazir.safety_is_confirmed(p_revision::uuid) THEN RAISE EXCEPTION 'safety_confirm_needed'; END IF;
  IF p_scope NOT IN ('full','replies_only') OR p_scope IS NULL THEN RAISE EXCEPTION 'safety_sdk_needed'; END IF;
  IF p_scope='full' AND NOT nazir.safety_sdk_fresh(p_revision::uuid) THEN RAISE EXCEPTION 'safety_sdk_needed'; END IF;
 ELSE
  IF p_scope IS DISTINCT FROM 'sample' THEN RAISE EXCEPTION 'safety_sdk_needed'; END IF;
 END IF;
 SELECT id INTO rid FROM nazir.safety_runs WHERE workspace_id=wid AND status IN ('queued','running') LIMIT 1;
 IF rid IS NOT NULL THEN RETURN rid; END IF;
 IF nazir.safety_next_at() IS NOT NULL THEN RAISE EXCEPTION 'safety_daily_limit'; END IF;
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

CREATE OR REPLACE FUNCTION nazir.read_external_agent() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE s nazir.external_agents; owner boolean;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 owner := nazir.member_has_role('service_owner');
 SELECT * INTO s FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id();
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('name',s.name,'host',substring(s.endpoint from '^https://([^/:?#]+)'),'ready',s.tested_at IS NOT NULL,'tested_at',s.tested_at,'connection_kind',CASE WHEN nazir.safety_sdk_fresh(s.revision) THEN 'sdk' ELSE 'api' END,'sdk_seen_at',CASE WHEN nazir.safety_sdk_fresh(s.revision) THEN s.sdk_seen_at ELSE NULL END,'sdk_version',s.sdk_version)
  || CASE WHEN owner THEN jsonb_build_object('revision',s.revision,'endpoint',s.endpoint,'format',s.format,'header_name',s.header_name,'key_saved',s.key_cipher IS NOT NULL,'key_last4',s.key_last4,'card_url',s.card_url,'card',s.card,'card_fetched_at',s.card_fetched_at,'a2a_interface',s.a2a_interface) ELSE '{}'::jsonb END;
END $$;

REVOKE ALL ON FUNCTION nazir.safety_sdk_fresh(uuid),nazir.safety_is_confirmed(uuid),nazir.safety_confirm(uuid,text),nazir.safety_next_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.safety_sdk_fresh(uuid),nazir.safety_is_confirmed(uuid),nazir.safety_confirm(uuid,text),nazir.safety_next_at() TO nazir_app;

CREATE OR REPLACE FUNCTION nazir.read_sdk_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE k nazir.sdk_keys; a nazir.external_agents; inv jsonb;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_can_work() THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 SELECT * INTO k FROM nazir.sdk_keys WHERE workspace_id=nazir.current_workspace_id() AND revoked_at IS NULL;
 SELECT * INTO a FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id();
 SELECT inventory INTO inv FROM nazir.agent_inventory WHERE workspace_id=nazir.current_workspace_id() ORDER BY received_at DESC LIMIT 1;
 RETURN jsonb_build_object('key_last4',k.last4,'key_created_at',k.created_at,'key_used_at',k.last_used_at,'sdk_seen_at',CASE WHEN nazir.safety_sdk_fresh(a.revision) THEN a.sdk_seen_at ELSE NULL END,'sdk_version',CASE WHEN nazir.safety_sdk_fresh(a.revision) THEN a.sdk_version ELSE NULL END,
  'tools',coalesce(jsonb_array_length(inv->'tools'),0),'mcp_servers',coalesce(jsonb_array_length(inv->'mcp_servers'),0));
END $$;
