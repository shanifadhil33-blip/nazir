-- N27: saved MCP servers callable from the agent chat. Reads (tools marked read only) run at once; any other tool call
-- is stored as proposed and runs only after an exact approval by another owner or reviewer. Names are stored on write
-- because members cannot read each other's member rows under RLS.
CREATE TABLE nazir.mcp_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id) ON DELETE CASCADE,
 server_name text NOT NULL CHECK (char_length(server_name) BETWEEN 1 AND 60),
 tool text NOT NULL CHECK (char_length(tool) BETWEEN 1 AND 120),
 arguments jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','done','failed')),
 proposed_by uuid NOT NULL, proposed_by_name text NOT NULL,
 approved_by uuid, approved_by_name text,
 result_excerpt text CHECK (result_excerpt IS NULL OR char_length(result_excerpt) <= 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 decided_at timestamptz
);
CREATE INDEX ON nazir.mcp_calls(workspace_id, created_at DESC);
ALTER TABLE nazir.mcp_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.mcp_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY mcp_calls_workspace ON nazir.mcp_calls TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
REVOKE ALL ON nazir.mcp_calls FROM PUBLIC;

CREATE FUNCTION nazir.my_member_name() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT coalesce(nullif(m.display_name,''),'Member') FROM nazir.members m WHERE m.id=nazir.current_member_id() $$;

-- Server only: full server list for a member of this workspace (addresses can carry tokens; never sent to a viewer client).
CREATE FUNCTION nazir.agent_mcp_servers() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN coalesce((SELECT mcp_servers FROM nazir.agent_settings WHERE workspace_id=nazir.current_workspace_id()),'[]');
END $$;

CREATE FUNCTION nazir.mcp_call_record(p_server text, p_tool text, p_args jsonb, p_status text, p_excerpt text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE new_id uuid;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_can_work() THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF p_status NOT IN ('proposed','done','failed') THEN RAISE EXCEPTION 'Check the details and try again.'; END IF;
 INSERT INTO nazir.mcp_calls(workspace_id,server_name,tool,arguments,status,proposed_by,proposed_by_name,result_excerpt)
  VALUES(nazir.current_workspace_id(),p_server,p_tool,coalesce(p_args,'{}'),p_status,nazir.current_member_id(),nazir.my_member_name(),left(p_excerpt,2000)) RETURNING id INTO new_id;
 PERFORM nazir.append_audit_internal('mcp.call_'||p_status,'mcp_call',new_id::text,jsonb_build_object('server',p_server,'tool',p_tool));
 RETURN new_id;
END $$;

-- Exact approval: only an owner or reviewer who did not propose it, only while proposed. Returns the call to run.
CREATE FUNCTION nazir.mcp_call_approve(p_id uuid) RETURNS TABLE(server_name text, tool text, arguments jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE c nazir.mcp_calls;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 SELECT * INTO c FROM nazir.mcp_calls m WHERE m.id=p_id AND m.workspace_id=nazir.current_workspace_id() FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
 IF c.status<>'proposed' THEN RAISE EXCEPTION 'state'; END IF;
 IF c.proposed_by=nazir.current_member_id() THEN RAISE EXCEPTION 'self_approval'; END IF;
 UPDATE nazir.mcp_calls m SET status='approved', approved_by=nazir.current_member_id(), approved_by_name=nazir.my_member_name(), decided_at=clock_timestamp() WHERE m.id=p_id;
 PERFORM nazir.append_audit_internal('mcp.call_approved','mcp_call',p_id::text,jsonb_build_object('server',c.server_name,'tool',c.tool));
 RETURN QUERY SELECT c.server_name, c.tool, c.arguments;
END $$;

CREATE FUNCTION nazir.mcp_call_finish(p_id uuid, p_ok boolean, p_excerpt text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 UPDATE nazir.mcp_calls SET status=CASE WHEN p_ok THEN 'done' ELSE 'failed' END, result_excerpt=left(p_excerpt,2000)
  WHERE id=p_id AND workspace_id=nazir.current_workspace_id() AND status='approved' AND approved_by=nazir.current_member_id();
 PERFORM nazir.append_audit_internal(CASE WHEN p_ok THEN 'mcp.call_done' ELSE 'mcp.call_failed' END,'mcp_call',p_id::text,'{}');
END $$;

CREATE FUNCTION nazir.mcp_call_list() RETURNS TABLE(id uuid, server_name text, tool text, status text, proposed_by_name text, approved_by_name text, created_at timestamptz) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN QUERY SELECT m.id,m.server_name,m.tool,m.status,m.proposed_by_name,m.approved_by_name,m.created_at FROM nazir.mcp_calls m WHERE m.workspace_id=nazir.current_workspace_id() ORDER BY m.created_at DESC LIMIT 20;
END $$;

-- Worker side: the sealed own model key for the workspace the worker is running in.
CREATE FUNCTION nazir.agent_model_secret_worker() RETURNS TABLE(provider text, base_url text, model text, key_cipher text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true)<>'nazir_worker' OR nazir.current_workspace_id() IS NULL THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN QUERY SELECT s.llm_provider, s.llm_base_url, s.llm_model, s.llm_key_cipher FROM nazir.agent_settings s WHERE s.workspace_id=nazir.current_workspace_id();
END $$;

REVOKE ALL ON FUNCTION nazir.my_member_name(), nazir.agent_mcp_servers(), nazir.mcp_call_record(text,text,jsonb,text,text), nazir.mcp_call_approve(uuid), nazir.mcp_call_finish(uuid,boolean,text), nazir.mcp_call_list(), nazir.agent_model_secret_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.agent_mcp_servers(), nazir.mcp_call_record(text,text,jsonb,text,text), nazir.mcp_call_approve(uuid), nazir.mcp_call_finish(uuid,boolean,text), nazir.mcp_call_list() TO nazir_app;
GRANT EXECUTE ON FUNCTION nazir.agent_model_secret_worker() TO nazir_worker;
