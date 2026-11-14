-- Chunk 1B: the Nazir SDK inside view. Test sessions, SDK keys, trace spans and the agent map.
-- Every table forces row level security. Writes go only through narrow SECURITY DEFINER functions.
CREATE TABLE nazir.test_sessions (
 id text PRIMARY KEY CHECK (id ~ '^ses_[0-9a-f]{32}$'),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id) ON DELETE CASCADE,
 run_id uuid, conversation_id uuid,
 mode text NOT NULL CHECK (mode IN ('quality','security','connect')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 hello_at timestamptz,
 span_count int NOT NULL DEFAULT 0
);
CREATE INDEX test_sessions_workspace ON nazir.test_sessions(workspace_id, created_at);
CREATE INDEX test_sessions_conversation ON nazir.test_sessions(conversation_id);

CREATE TABLE nazir.sdk_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id) ON DELETE CASCADE,
 key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
 last4 text NOT NULL CHECK (char_length(last4)=4),
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_used_at timestamptz,
 revoked_at timestamptz
);
CREATE UNIQUE INDEX sdk_keys_one_active ON nazir.sdk_keys(workspace_id) WHERE revoked_at IS NULL;

CREATE TABLE nazir.trace_spans (
 id bigserial PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id) ON DELETE CASCADE,
 session_id text NOT NULL REFERENCES nazir.test_sessions(id) ON DELETE CASCADE,
 turn int NOT NULL CHECK (turn BETWEEN 0 AND 100),
 trace_id text CHECK (char_length(trace_id)<=64), span_id text CHECK (char_length(span_id)<=64), parent_span_id text CHECK (char_length(parent_span_id)<=64),
 kind text NOT NULL CHECK (kind IN ('invoke_agent','execute_tool','chat','nazir.action','nazir.turn.end','nazir.hello','nazir.blocked')),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
 started_at timestamptz, ended_at timestamptz,
 status text NOT NULL DEFAULT 'OK' CHECK (status IN ('OK','ERROR','UNSET')),
 attributes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes)='object' AND octet_length(attributes::text)<=65536),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX trace_spans_session ON nazir.trace_spans(workspace_id, session_id, turn);
CREATE INDEX trace_spans_received ON nazir.trace_spans(workspace_id, received_at);

CREATE TABLE nazir.agent_inventory (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id) ON DELETE CASCADE,
 content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
 inventory jsonb NOT NULL CHECK (jsonb_typeof(inventory)='object' AND octet_length(inventory::text)<=262144),
 source text NOT NULL CHECK (source IN ('sdk','a2a_card')),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX agent_inventory_workspace ON nazir.agent_inventory(workspace_id, received_at DESC);

ALTER TABLE nazir.external_agents ADD COLUMN sdk_seen_at timestamptz, ADD COLUMN sdk_version text CHECK (char_length(sdk_version)<=40);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['test_sessions','sdk_keys','trace_spans','agent_inventory'] LOOP
  EXECUTE format('ALTER TABLE nazir.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE nazir.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON nazir.%I FROM PUBLIC', t);
  EXECUTE format('CREATE POLICY sdk_workspace_read ON nazir.%I FOR SELECT TO nazir_app,nazir_worker USING (workspace_id=nazir.current_workspace_id())', t);
 END LOOP;
END $$;
GRANT SELECT ON nazir.test_sessions, nazir.trace_spans, nazir.agent_inventory TO nazir_app, nazir_worker;
GRANT SELECT(id,workspace_id,last4,created_at,last_used_at,revoked_at) ON nazir.sdk_keys TO nazir_app;

-- Opened by the person (connection test) or the background runner acting as the person who started the check.
CREATE FUNCTION nazir.open_test_session(p_mode text, p_run uuid DEFAULT NULL, p_conversation uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE sid text;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (current_setting('role',true)='nazir_worker' OR nazir.member_can_work()) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF p_mode NOT IN ('quality','security','connect') THEN RAISE EXCEPTION 'Invalid mode'; END IF;
 IF p_run IS NOT NULL AND NOT EXISTS(SELECT 1 FROM nazir.runs WHERE id=p_run AND workspace_id=nazir.current_workspace_id()) THEN RAISE EXCEPTION 'Invalid run'; END IF;
 sid := 'ses_' || replace(gen_random_uuid()::text,'-','');
 INSERT INTO nazir.test_sessions(id,workspace_id,run_id,conversation_id,mode) VALUES(sid,nazir.current_workspace_id(),p_run,p_conversation,p_mode);
 RETURN sid;
END $$;
REVOKE ALL ON FUNCTION nazir.open_test_session(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.open_test_session(text,uuid,uuid) TO nazir_app, nazir_worker;

-- One active key per workspace. The raw key never reaches the database, only its SHA256.
CREATE FUNCTION nazir.issue_sdk_key(p_hash text, p_last4 text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE kid uuid;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=nazir.current_workspace_id() AND kind='real') THEN RAISE EXCEPTION 'demo_connection'; END IF;
 UPDATE nazir.sdk_keys SET revoked_at=clock_timestamp() WHERE workspace_id=nazir.current_workspace_id() AND revoked_at IS NULL;
 INSERT INTO nazir.sdk_keys(workspace_id,key_hash,last4,created_by) VALUES(nazir.current_workspace_id(),p_hash,p_last4,nullif(current_setting('app.member_id',true),'')::uuid) RETURNING id INTO kid;
 PERFORM nazir.append_audit_internal('sdk.key_made','workspace',nazir.current_workspace_id()::text,jsonb_build_object('last4',p_last4));
 RETURN kid;
END $$;
CREATE FUNCTION nazir.revoke_sdk_key() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 UPDATE nazir.sdk_keys SET revoked_at=clock_timestamp() WHERE workspace_id=nazir.current_workspace_id() AND revoked_at IS NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM nazir.append_audit_internal('sdk.key_turned_off','workspace',nazir.current_workspace_id()::text,'{}');
 RETURN true;
END $$;
CREATE FUNCTION nazir.read_sdk_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE k nazir.sdk_keys; a nazir.external_agents; inv jsonb;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_can_work() THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 SELECT * INTO k FROM nazir.sdk_keys WHERE workspace_id=nazir.current_workspace_id() AND revoked_at IS NULL;
 SELECT * INTO a FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id();
 SELECT inventory INTO inv FROM nazir.agent_inventory WHERE workspace_id=nazir.current_workspace_id() ORDER BY received_at DESC LIMIT 1;
 RETURN jsonb_build_object('key_last4',k.last4,'key_created_at',k.created_at,'key_used_at',k.last_used_at,'sdk_seen_at',a.sdk_seen_at,'sdk_version',a.sdk_version,
  'tools',coalesce(jsonb_array_length(inv->'tools'),0),'mcp_servers',coalesce(jsonb_array_length(inv->'mcp_servers'),0));
END $$;
REVOKE ALL ON FUNCTION nazir.issue_sdk_key(text,text), nazir.revoke_sdk_key(), nazir.read_sdk_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.issue_sdk_key(text,text), nazir.revoke_sdk_key(), nazir.read_sdk_status() TO nazir_app;

-- A narrow role for SDK ingest. It can run only the two ingest functions below.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nazir_ingest') THEN CREATE ROLE nazir_ingest NOLOGIN; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='nazir_login') THEN GRANT nazir_ingest TO nazir_login; END IF;
END $$;
GRANT USAGE ON SCHEMA nazir TO nazir_ingest;

-- Ingest runs with no member: the key proves the workspace, and only sessions Nazir issued to that workspace accept spans.
CREATE FUNCTION nazir.ingest_spans(p_hash text, p_session text, p_spans jsonb, p_sdk_version text) RETURNS int
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
  UPDATE nazir.external_agents SET sdk_seen_at=clock_timestamp(), sdk_version=left(p_sdk_version,40), connection_kind='sdk' WHERE workspace_id=k.workspace_id;
 END IF;
 RETURN n;
END $$;
CREATE FUNCTION nazir.ingest_inventory(p_hash text, p_content_hash text, p_inventory jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE k nazir.sdk_keys; latest text; recent int;
BEGIN
 SELECT * INTO k FROM nazir.sdk_keys WHERE key_hash=p_hash AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'sdk_key'; END IF;
 SELECT content_hash INTO latest FROM nazir.agent_inventory WHERE workspace_id=k.workspace_id ORDER BY received_at DESC LIMIT 1;
 IF latest=p_content_hash THEN RETURN false; END IF;
 SELECT count(*) INTO recent FROM nazir.agent_inventory WHERE workspace_id=k.workspace_id AND received_at>clock_timestamp()-interval '1 hour';
 IF recent>=20 THEN RAISE EXCEPTION 'sdk_limit'; END IF;
 INSERT INTO nazir.agent_inventory(workspace_id,content_hash,inventory,source) VALUES(k.workspace_id,p_content_hash,p_inventory,'sdk');
 DELETE FROM nazir.agent_inventory WHERE workspace_id=k.workspace_id AND id NOT IN (SELECT id FROM nazir.agent_inventory WHERE workspace_id=k.workspace_id ORDER BY received_at DESC LIMIT 10);
 UPDATE nazir.sdk_keys SET last_used_at=clock_timestamp() WHERE id=k.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION nazir.ingest_spans(text,text,jsonb,text), nazir.ingest_inventory(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.ingest_spans(text,text,jsonb,text), nazir.ingest_inventory(text,text,jsonb) TO nazir_ingest;

-- Settings, Your agent: "Delete all traces".
CREATE FUNCTION nazir.delete_traces() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE n int;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 DELETE FROM nazir.trace_spans WHERE workspace_id=nazir.current_workspace_id();
 GET DIAGNOSTICS n = ROW_COUNT;
 PERFORM nazir.append_audit_internal('sdk.traces_deleted','workspace',nazir.current_workspace_id()::text,jsonb_build_object('count',n));
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION nazir.delete_traces() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.delete_traces() TO nazir_app;

-- Spans are kept 30 days. The daily cron calls this as the worker.
CREATE FUNCTION nazir.prune_traces() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE n int;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'nazir_worker' THEN RAISE EXCEPTION 'Worker required'; END IF;
 DELETE FROM nazir.test_sessions WHERE created_at<clock_timestamp()-interval '30 days';
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION nazir.prune_traces() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.prune_traces() TO nazir_worker;

-- The connection read now says when the SDK was last seen and its version.
CREATE OR REPLACE FUNCTION nazir.read_external_agent() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE s nazir.external_agents; owner boolean;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 owner := nazir.member_has_role('service_owner');
 SELECT * INTO s FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id();
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('name',s.name,'host',substring(s.endpoint from '^https://([^/:?#]+)'),'ready',s.tested_at IS NOT NULL,'tested_at',s.tested_at,'connection_kind',s.connection_kind,'sdk_seen_at',s.sdk_seen_at,'sdk_version',s.sdk_version)
  || CASE WHEN owner THEN jsonb_build_object('revision',s.revision,'endpoint',s.endpoint,'format',s.format,'header_name',s.header_name,'key_saved',s.key_cipher IS NOT NULL,'key_last4',s.key_last4,'card_url',s.card_url,'card',s.card,'card_fetched_at',s.card_fetched_at,'a2a_interface',s.a2a_interface) ELSE '{}'::jsonb END;
END $$;
