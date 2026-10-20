-- N26: agent settings per workspace. The model key is stored only as AES GCM ciphertext made on the server; no function returns it to a client.
CREATE TABLE nazir.agent_settings (
 workspace_id uuid PRIMARY KEY REFERENCES nazir.workspaces(id) ON DELETE CASCADE,
 name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 60),
 instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 2000),
 language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','ar')),
 avatar text NOT NULL DEFAULT 'preset:1' CHECK (char_length(avatar) <= 300000),
 mcp_servers jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(mcp_servers)='array'),
 integrations jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(integrations)='array'),
 llm_provider text CHECK (llm_provider IS NULL OR llm_provider IN ('openai','anthropic','gemini','openrouter','groq','custom')),
 llm_base_url text CHECK (llm_base_url IS NULL OR char_length(llm_base_url) <= 300),
 llm_model text CHECK (llm_model IS NULL OR char_length(llm_model) <= 120),
 llm_key_cipher text CHECK (llm_key_cipher IS NULL OR char_length(llm_key_cipher) <= 2000),
 llm_key_last4 text CHECK (llm_key_last4 IS NULL OR char_length(llm_key_last4) <= 4),
 updated_by uuid,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE nazir.agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.agent_settings FORCE ROW LEVEL SECURITY;
-- No grants to app or worker: only the definer functions below touch rows. The policy is a second fence.
CREATE POLICY settings_workspace ON nazir.agent_settings TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
REVOKE ALL ON nazir.agent_settings FROM PUBLIC;

-- Safe read for any member. Viewers never see the key ending, instructions stay readable, server addresses are reduced to their host.
CREATE FUNCTION nazir.read_agent_settings() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE s nazir.agent_settings; owner boolean;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 owner := nazir.member_has_role('service_owner');
 SELECT * INTO s FROM nazir.agent_settings WHERE workspace_id=nazir.current_workspace_id();
 RETURN jsonb_build_object(
  'name', s.name, 'instructions', coalesce(s.instructions,''), 'language', coalesce(s.language,'en'), 'avatar', coalesce(s.avatar,'preset:1'),
  'mcp_servers', CASE WHEN owner THEN coalesce(s.mcp_servers,'[]') ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('name',e->>'name','host',substring(e->>'url' from '^https://([^/:?#]+)'))) FROM jsonb_array_elements(s.mcp_servers) e),'[]') END,
  'integrations', coalesce(s.integrations,'[]'),
  'llm', CASE WHEN s.llm_provider IS NULL THEN NULL WHEN owner THEN jsonb_build_object('provider',s.llm_provider,'base_url',s.llm_base_url,'model',s.llm_model,'key_last4',s.llm_key_last4)
              ELSE jsonb_build_object('provider',s.llm_provider,'model',s.llm_model,'has_key',s.llm_key_cipher IS NOT NULL) END,
  'can_edit', owner);
END $$;

CREATE FUNCTION nazir.save_agent_settings(p jsonb, key_cipher text, key_last4 text, clear_key boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 INSERT INTO nazir.agent_settings(workspace_id) VALUES(nazir.current_workspace_id()) ON CONFLICT DO NOTHING;
 UPDATE nazir.agent_settings SET
  name=nullif(p->>'name',''), instructions=coalesce(p->>'instructions',''), language=coalesce(p->>'language','en'), avatar=coalesce(p->>'avatar','preset:1'),
  mcp_servers=coalesce(p->'mcp_servers','[]'), integrations=coalesce(p->'integrations','[]'),
  llm_provider=nullif(p->>'llm_provider',''), llm_base_url=nullif(p->>'llm_base_url',''), llm_model=nullif(p->>'llm_model',''),
  llm_key_cipher=CASE WHEN clear_key OR nullif(p->>'llm_provider','') IS NULL THEN NULL WHEN key_cipher IS NOT NULL THEN key_cipher ELSE llm_key_cipher END,
  llm_key_last4=CASE WHEN clear_key OR nullif(p->>'llm_provider','') IS NULL THEN NULL WHEN key_cipher IS NOT NULL THEN key_last4 ELSE llm_key_last4 END,
  updated_by=nazir.current_member_id(), updated_at=clock_timestamp()
 WHERE workspace_id=nazir.current_workspace_id();
 PERFORM nazir.append_audit_internal('agent.settings_saved','workspace',nazir.current_workspace_id()::text,jsonb_build_object('key_changed',key_cipher IS NOT NULL OR clear_key,'provider',p->>'llm_provider'));
END $$;

-- Server side only: the ciphertext for the chat route of a member of this workspace. Decryption needs the server secret.
CREATE FUNCTION nazir.agent_model_secret() RETURNS TABLE(provider text, base_url text, model text, key_cipher text, instructions text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN QUERY SELECT s.llm_provider, s.llm_base_url, s.llm_model, s.llm_key_cipher, s.instructions FROM nazir.agent_settings s WHERE s.workspace_id=nazir.current_workspace_id();
END $$;
REVOKE ALL ON FUNCTION nazir.read_agent_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION nazir.save_agent_settings(jsonb,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION nazir.agent_model_secret() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.read_agent_settings() TO nazir_app;
GRANT EXECUTE ON FUNCTION nazir.save_agent_settings(jsonb,text,text,boolean) TO nazir_app;
GRANT EXECUTE ON FUNCTION nazir.agent_model_secret() TO nazir_app;
