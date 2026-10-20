-- N21 in app agent chat and revocable MCP tokens. Tokens are stored as SHA256 only.
CREATE TABLE nazir.agent_threads (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 member_id uuid NOT NULL,
 FOREIGN KEY(workspace_id,member_id) REFERENCES nazir.members(workspace_id,id)
);
CREATE TABLE nazir.agent_messages (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 thread_id uuid NOT NULL,
 seq int NOT NULL CHECK(seq>0),
 role text NOT NULL CHECK(role IN ('member','nazir')),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 4000),
 tool_name text,
 tool_result jsonb,
 UNIQUE(thread_id,seq),
 FOREIGN KEY(workspace_id,thread_id) REFERENCES nazir.agent_threads(workspace_id,id)
);
CREATE INDEX ON nazir.agent_messages(workspace_id,created_at,id);
CREATE TABLE nazir.mcp_tokens (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 member_id uuid NOT NULL,
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 80),
 revoked_at timestamptz,
 UNIQUE(token_hash),
 FOREIGN KEY(workspace_id,member_id) REFERENCES nazir.members(workspace_id,id)
);
CREATE INDEX ON nazir.mcp_tokens(workspace_id,member_id);
ALTER TABLE nazir.agent_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.agent_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE nazir.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.agent_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE nazir.mcp_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.mcp_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace ON nazir.agent_threads TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
CREATE POLICY workspace ON nazir.agent_messages TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
CREATE POLICY workspace ON nazir.mcp_tokens TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
CREATE POLICY agent_thread_scope ON nazir.agent_threads AS RESTRICTIVE FOR ALL TO nazir_app
 USING(member_id=nazir.current_member_id() OR nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer'))
 WITH CHECK(member_id=nazir.current_member_id());
CREATE POLICY agent_message_scope ON nazir.agent_messages AS RESTRICTIVE FOR ALL TO nazir_app
 USING(EXISTS(SELECT 1 FROM nazir.agent_threads t WHERE t.id=agent_messages.thread_id AND t.workspace_id=agent_messages.workspace_id AND (t.member_id=nazir.current_member_id() OR nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer'))))
 WITH CHECK(EXISTS(SELECT 1 FROM nazir.agent_threads t WHERE t.id=thread_id AND t.workspace_id=nazir.current_workspace_id() AND t.member_id=nazir.current_member_id()));
CREATE POLICY mcp_token_read ON nazir.mcp_tokens AS RESTRICTIVE FOR SELECT TO nazir_app USING(member_id=nazir.current_member_id() OR nazir.member_has_role('service_owner'));
CREATE POLICY mcp_token_insert ON nazir.mcp_tokens AS RESTRICTIVE FOR INSERT TO nazir_app WITH CHECK(member_id=nazir.current_member_id());
CREATE POLICY mcp_token_update ON nazir.mcp_tokens AS RESTRICTIVE FOR UPDATE TO nazir_app
 USING(member_id=nazir.current_member_id() OR nazir.member_has_role('service_owner'))
 WITH CHECK(member_id=nazir.current_member_id() OR nazir.member_has_role('service_owner'));
GRANT SELECT,INSERT ON nazir.agent_threads,nazir.agent_messages TO nazir_app;
GRANT SELECT ON nazir.agent_threads,nazir.agent_messages TO nazir_worker;
GRANT SELECT,INSERT ON nazir.mcp_tokens TO nazir_app;
GRANT UPDATE(revoked_at) ON nazir.mcp_tokens TO nazir_app;
GRANT SELECT ON nazir.mcp_tokens TO nazir_worker;
CREATE FUNCTION nazir.agent_thread_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true)='nazir_app' THEN NEW.member_id:=nazir.current_member_id(); END IF;
 IF NEW.member_id IS NULL THEN RAISE EXCEPTION 'Thread member required'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.agent_thread_insert() FROM PUBLIC;
CREATE TRIGGER agent_thread_insert BEFORE INSERT ON nazir.agent_threads FOR EACH ROW EXECUTE FUNCTION nazir.agent_thread_insert();
CREATE FUNCTION nazir.mcp_token_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF TG_OP='INSERT' AND current_setting('role',true)='nazir_app' THEN
  NEW.member_id:=nazir.current_member_id();
  NEW.revoked_at:=NULL;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.member_id IS DISTINCT FROM OLD.member_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.label IS DISTINCT FROM OLD.label THEN
   RAISE EXCEPTION 'Token identity is immutable';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'A revoked token stays revoked'; END IF;
  IF NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'Revoke sets the time'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.mcp_token_guard() FROM PUBLIC;
CREATE TRIGGER mcp_token_guard BEFORE INSERT OR UPDATE ON nazir.mcp_tokens FOR EACH ROW EXECUTE FUNCTION nazir.mcp_token_guard();
-- Resolves a bearer token to its member. Revoked and removed members resolve to nothing.
CREATE FUNCTION nazir.mcp_resolve(p_hash text) RETURNS TABLE(member_id uuid,workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT t.member_id,t.workspace_id FROM nazir.mcp_tokens t
 JOIN nazir.members m ON m.id=t.member_id AND m.workspace_id=t.workspace_id AND m.status='active'
 WHERE t.token_hash=p_hash AND t.revoked_at IS NULL
$$;
REVOKE ALL ON FUNCTION nazir.mcp_resolve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.mcp_resolve(text) TO nazir_app,nazir_worker;
