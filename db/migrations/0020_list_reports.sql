-- N19: list report ids for any member of the current workspace (viewer included). Bodies still come through read_report or read_report_viewer.
CREATE FUNCTION nazir.list_reports() RETURNS TABLE(id uuid, created_at timestamptz, run_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN QUERY SELECT r.id, r.created_at, r.run_id FROM nazir.reports r WHERE r.workspace_id=nazir.current_workspace_id() ORDER BY r.created_at DESC, r.id DESC LIMIT 20;
END $$;
REVOKE ALL ON FUNCTION nazir.list_reports() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.list_reports() TO nazir_app;
