-- Outside only agent connections. Secrets have no table grants and no public read projection.
CREATE TABLE nazir.external_agents (
 workspace_id uuid PRIMARY KEY REFERENCES nazir.workspaces(id) ON DELETE CASCADE,
 revision uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 60),
 endpoint text NOT NULL CHECK(char_length(endpoint) BETWEEN 1 AND 2000),
 format text NOT NULL CHECK(format IN ('openai_chat','simple_json')),
 header_name text CHECK(char_length(header_name) BETWEEN 1 AND 100),
 key_cipher text,
 key_last4 text CHECK(char_length(key_last4)<=4),
 tested_at timestamptz
);
CREATE TABLE nazir.external_agent_limits (
 workspace_id uuid PRIMARY KEY REFERENCES nazir.workspaces(id) ON DELETE CASCADE,
 sends timestamptz[] NOT NULL DEFAULT '{}'
);
ALTER TABLE nazir.external_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.external_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE nazir.external_agent_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.external_agent_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY external_workspace ON nazir.external_agents TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
CREATE POLICY external_limit_workspace ON nazir.external_agent_limits TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
REVOKE ALL ON nazir.external_agents,nazir.external_agent_limits FROM PUBLIC;

CREATE FUNCTION nazir.read_external_agent() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE s nazir.external_agents; owner boolean;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 owner := nazir.member_has_role('service_owner');
 SELECT * INTO s FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id();
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('name',s.name,'host',substring(s.endpoint from '^https://([^/:?#]+)'),'ready',s.tested_at IS NOT NULL)
  || CASE WHEN owner THEN jsonb_build_object('endpoint',s.endpoint,'format',s.format,'header_name',s.header_name,'key_saved',s.key_cipher IS NOT NULL,'key_last4',s.key_last4) ELSE '{}'::jsonb END;
END $$;

CREATE FUNCTION nazir.save_external_agent(p jsonb, cipher text, last4 text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 INSERT INTO nazir.external_agents(workspace_id,name,endpoint,format,header_name,key_cipher,key_last4)
 VALUES(nazir.current_workspace_id(),p->>'name',p->>'endpoint',p->>'format',nullif(p->>'header_name',''),cipher,last4)
 ON CONFLICT(workspace_id) DO UPDATE SET name=excluded.name,endpoint=excluded.endpoint,format=excluded.format,header_name=excluded.header_name,
 key_cipher=CASE WHEN excluded.header_name IS NULL THEN NULL WHEN cipher IS NOT NULL THEN cipher ELSE external_agents.key_cipher END,
 key_last4=CASE WHEN excluded.header_name IS NULL THEN NULL WHEN cipher IS NOT NULL THEN last4 ELSE external_agents.key_last4 END,
 revision=gen_random_uuid(),tested_at=NULL;
 PERFORM nazir.append_audit_internal('agent.connection_saved','workspace',nazir.current_workspace_id()::text,jsonb_build_object('key_changed',cipher IS NOT NULL));
END $$;
CREATE FUNCTION nazir.remove_external_agent() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 DELETE FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id();
 PERFORM nazir.append_audit_internal('agent.connection_removed','workspace',nazir.current_workspace_id()::text,'{}');
END $$;

-- Reserves a test send atomically across owners and processes. Failed sends also consume the limit.
CREATE FUNCTION nazir.external_agent_test_secret() RETURNS SETOF nazir.external_agents LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE recent timestamptz[];
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 INSERT INTO nazir.external_agent_limits(workspace_id) VALUES(nazir.current_workspace_id()) ON CONFLICT DO NOTHING;
 SELECT sends INTO recent FROM nazir.external_agent_limits WHERE workspace_id=nazir.current_workspace_id() FOR UPDATE;
 recent := ARRAY(SELECT t FROM unnest(recent) t WHERE t>clock_timestamp()-interval '1 hour');
 IF cardinality(recent)>=20 THEN RAISE EXCEPTION 'external_rate_limit'; END IF;
 UPDATE nazir.external_agent_limits SET sends=array_append(recent,clock_timestamp()) WHERE workspace_id=nazir.current_workspace_id();
 RETURN QUERY SELECT * FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id();
END $$;
CREATE FUNCTION nazir.external_agent_tested(rev uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 UPDATE nazir.external_agents SET tested_at=clock_timestamp() WHERE workspace_id=nazir.current_workspace_id() AND revision=rev;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM nazir.append_audit_internal('agent.connection_tested','workspace',nazir.current_workspace_id()::text,'{}');
 RETURN true;
END $$;
CREATE FUNCTION nazir.external_agent_worker() RETURNS SETOF nazir.external_agents LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT * FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id()
$$;
REVOKE ALL ON FUNCTION nazir.read_external_agent(),nazir.save_external_agent(jsonb,text,text),nazir.remove_external_agent(),nazir.external_agent_test_secret(),nazir.external_agent_tested(uuid),nazir.external_agent_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.read_external_agent(),nazir.save_external_agent(jsonb,text,text),nazir.remove_external_agent(),nazir.external_agent_test_secret(),nazir.external_agent_tested(uuid) TO nazir_app;
GRANT EXECUTE ON FUNCTION nazir.external_agent_worker() TO nazir_worker;

-- A frozen external run searches its chosen pack even if settings change while it is queued.
CREATE FUNCTION nazir.knowledge_search_pack_worker(p_pack text,p_terms text[],p_agent uuid,p_limit int) RETURNS TABLE(chunk_id uuid,doc_id uuid,title text,kind text,seq int,content text,rank real) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT * FROM nazir.knowledge_find(p_pack,p_terms,p_agent,p_limit)
$$;
REVOKE ALL ON FUNCTION nazir.knowledge_search_pack_worker(text,text[],uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.knowledge_search_pack_worker(text,text[],uuid,int) TO nazir_worker;
