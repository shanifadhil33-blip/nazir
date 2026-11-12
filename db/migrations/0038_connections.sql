-- Prepared for Bilal to apply after the gate. No production migration is run by this change.
ALTER TABLE nazir.external_agents
 ADD COLUMN connection_kind text NOT NULL DEFAULT 'api' CHECK(connection_kind IN ('api','sdk')),
 ADD COLUMN card_url text CHECK(char_length(card_url)<=2000),
 ADD COLUMN card jsonb CHECK(jsonb_typeof(card)='object' AND octet_length(card::text)<=65536),
 ADD COLUMN card_fetched_at timestamptz,
 ADD COLUMN a2a_interface jsonb CHECK(jsonb_typeof(a2a_interface)='object' AND octet_length(a2a_interface::text)<=4096
   AND a2a_interface ?& ARRAY['url','transport','version']
   AND a2a_interface - ARRAY['url','transport','version','headerName','authType']='{}'::jsonb
   AND a2a_interface->>'transport' IN ('JSONRPC','HTTP+JSON') AND a2a_interface->>'version' IN ('1.0','0.3')
   AND char_length(a2a_interface->>'url') BETWEEN 1 AND 2000);
ALTER TABLE nazir.external_agents DROP CONSTRAINT external_agents_format_check;
ALTER TABLE nazir.external_agents ADD CONSTRAINT external_agents_format_check CHECK(format IN ('openai_chat','simple_json','a2a'));

CREATE OR REPLACE FUNCTION nazir.read_external_agent() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE s nazir.external_agents; owner boolean;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 owner := nazir.member_has_role('service_owner');
 SELECT * INTO s FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id();
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('name',s.name,'host',substring(s.endpoint from '^https://([^/:?#]+)'),'ready',s.tested_at IS NOT NULL,'tested_at',s.tested_at,'connection_kind',s.connection_kind)
  || CASE WHEN owner THEN jsonb_build_object('revision',s.revision,'endpoint',s.endpoint,'format',s.format,'header_name',s.header_name,'key_saved',s.key_cipher IS NOT NULL,'key_last4',s.key_last4,'card_url',s.card_url,'card',s.card,'card_fetched_at',s.card_fetched_at,'a2a_interface',s.a2a_interface) ELSE '{}'::jsonb END;
END $$;

CREATE OR REPLACE FUNCTION nazir.save_external_agent(p jsonb, cipher text, last4 text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=nazir.current_workspace_id() AND kind='real') THEN RAISE EXCEPTION 'demo_connection'; END IF;
 INSERT INTO nazir.external_agents(workspace_id,name,endpoint,format,header_name,key_cipher,key_last4,connection_kind,card_url,card,card_fetched_at,a2a_interface)
 VALUES(nazir.current_workspace_id(),p->>'name',p->>'endpoint',p->>'format',nullif(p->>'header_name',''),cipher,last4,'api',p->>'card_url',p->'card',(p->>'card_fetched_at')::timestamptz,p->'a2a_interface')
 ON CONFLICT(workspace_id) DO UPDATE SET name=excluded.name,endpoint=excluded.endpoint,format=excluded.format,header_name=excluded.header_name,
 connection_kind='api',card_url=excluded.card_url,card=excluded.card,card_fetched_at=excluded.card_fetched_at,a2a_interface=excluded.a2a_interface,
 key_cipher=CASE WHEN excluded.header_name IS NULL THEN NULL WHEN cipher IS NOT NULL THEN cipher WHEN coalesce((p->>'keep_key')::boolean,false) AND excluded.endpoint=external_agents.endpoint AND excluded.header_name IS NOT DISTINCT FROM external_agents.header_name THEN external_agents.key_cipher ELSE NULL END,
 key_last4=CASE WHEN excluded.header_name IS NULL THEN NULL WHEN cipher IS NOT NULL THEN last4 WHEN coalesce((p->>'keep_key')::boolean,false) AND excluded.endpoint=external_agents.endpoint AND excluded.header_name IS NOT DISTINCT FROM external_agents.header_name THEN external_agents.key_last4 ELSE NULL END,
 revision=gen_random_uuid(),tested_at=NULL;
 PERFORM nazir.append_audit_internal('agent.connection_saved','workspace',nazir.current_workspace_id()::text,jsonb_build_object('key_changed',cipher IS NOT NULL));
END $$;
CREATE OR REPLACE FUNCTION nazir.remove_external_agent() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=nazir.current_workspace_id() AND kind='real') THEN RAISE EXCEPTION 'demo_connection'; END IF;
 DELETE FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id();
 PERFORM nazir.append_audit_internal('agent.connection_removed','workspace',nazir.current_workspace_id()::text,'{}');
END $$;

-- Reserves a test send atomically across owners and processes. Failed sends also consume the limit.
CREATE OR REPLACE FUNCTION nazir.external_agent_test_secret() RETURNS SETOF nazir.external_agents LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE recent timestamptz[];
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=nazir.current_workspace_id() AND kind='real') THEN RAISE EXCEPTION 'demo_connection'; END IF;
 INSERT INTO nazir.external_agent_limits(workspace_id) VALUES(nazir.current_workspace_id()) ON CONFLICT DO NOTHING;
 SELECT sends INTO recent FROM nazir.external_agent_limits WHERE workspace_id=nazir.current_workspace_id() FOR UPDATE;
 recent := ARRAY(SELECT t FROM unnest(recent) t WHERE t>clock_timestamp()-interval '1 hour');
 IF cardinality(recent)>=20 THEN RAISE EXCEPTION 'external_rate_limit'; END IF;
 UPDATE nazir.external_agent_limits SET sends=array_append(recent,clock_timestamp()) WHERE workspace_id=nazir.current_workspace_id();
 RETURN QUERY SELECT * FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id();
END $$;
CREATE OR REPLACE FUNCTION nazir.external_agent_tested(rev uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=nazir.current_workspace_id() AND kind='real') THEN RAISE EXCEPTION 'demo_connection'; END IF;
 UPDATE nazir.external_agents SET tested_at=clock_timestamp() WHERE workspace_id=nazir.current_workspace_id() AND revision=rev;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM nazir.append_audit_internal('agent.connection_tested','workspace',nazir.current_workspace_id()::text,'{}');
 RETURN true;
END $$;
