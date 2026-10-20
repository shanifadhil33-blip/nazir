-- Viewers may audit only the chat and connector writes their role is allowed to perform.
CREATE OR REPLACE FUNCTION nazir.append_audit(action text,target_type text,target_id text,payload jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true)='nazir_app' AND nazir.current_workspace_id() IS NOT NULL AND NOT nazir.member_can_work() THEN
  IF NOT (nazir.member_has_role('viewer') AND action IN ('agent.message','mcp.issued','mcp.revoked')) THEN
   RAISE EXCEPTION 'Your role cannot do this.';
  END IF;
 END IF;
 PERFORM nazir.append_audit_internal(action,target_type,target_id,payload);
END $$;
