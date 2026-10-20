-- N20 reports: one saved snapshot, a full copy, a development copy, and a redacted viewer copy.
CREATE FUNCTION nazir.report_copy_ok(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT p IS NOT NULL AND jsonb_typeof(p)='object'
  AND position('within tested scope, not a certificate' in coalesce(p->'scope'->>'en',''))>0
  AND position('هذه النتائج ضمن النطاق المختبر، وليست شهادة.' in coalesce(p->'scope'->>'ar',''))>0
$$;
REVOKE ALL ON FUNCTION nazir.report_copy_ok(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.report_copy_ok(jsonb) TO nazir_app;
CREATE TABLE nazir.reports (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 run_id uuid NOT NULL,
 created_by uuid,
 body jsonb NOT NULL,
 supplier_body jsonb NOT NULL,
 viewer_body jsonb NOT NULL,
 body_hash text NOT NULL DEFAULT '',
 CHECK(nazir.report_copy_ok(body) AND nazir.report_copy_ok(supplier_body) AND nazir.report_copy_ok(viewer_body)),
 FOREIGN KEY(workspace_id,run_id) REFERENCES nazir.runs(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES nazir.members(workspace_id,id)
);
CREATE INDEX ON nazir.reports(workspace_id,run_id);
ALTER TABLE nazir.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.reports FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace ON nazir.reports TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
-- Raw rows are for the service owner and the reviewer. The supplier and the viewer use the functions below.
CREATE POLICY report_read_scope ON nazir.reports AS RESTRICTIVE FOR SELECT TO nazir_app USING(nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer'));
CREATE POLICY report_insert_scope ON nazir.reports AS RESTRICTIVE FOR INSERT TO nazir_app WITH CHECK(nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer') OR nazir.member_has_role('supplier_maintainer'));
GRANT SELECT,INSERT ON nazir.reports TO nazir_app;
GRANT SELECT ON nazir.reports TO nazir_worker;
CREATE FUNCTION nazir.report_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true)='nazir_app' THEN NEW.created_by:=nazir.current_member_id(); END IF;
 IF NEW.created_by IS NULL THEN RAISE EXCEPTION 'Report author required'; END IF;
 NEW.created_at:=clock_timestamp();
 NEW.body_hash:=encode(sha256(convert_to(nazir.runner_canonical(NEW.body),'UTF8')),'hex');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.report_insert() FROM PUBLIC;
CREATE TRIGGER report_insert BEFORE INSERT ON nazir.reports FOR EACH ROW EXECUTE FUNCTION nazir.report_insert();
CREATE FUNCTION nazir.report_frozen() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN RAISE EXCEPTION 'Reports cannot change'; END $$;
REVOKE ALL ON FUNCTION nazir.report_frozen() FROM PUBLIC;
CREATE TRIGGER report_frozen BEFORE UPDATE OR DELETE ON nazir.reports FOR EACH ROW EXECUTE FUNCTION nazir.report_frozen();
CREATE TRIGGER report_no_truncate BEFORE TRUNCATE ON nazir.reports FOR EACH STATEMENT EXECUTE FUNCTION nazir.report_frozen();
-- Full copy. A viewer is refused. A supplier receives the development copy, which keeps quotes and drops hidden cases.
CREATE FUNCTION nazir.read_report(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE full_body jsonb; safe_body jsonb;
BEGIN
 IF nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer') THEN
  SELECT body INTO full_body FROM nazir.reports WHERE id=p_id AND workspace_id=nazir.current_workspace_id();
  RETURN full_body;
 END IF;
 IF nazir.member_has_role('supplier_maintainer') THEN
  SELECT supplier_body INTO safe_body FROM nazir.reports WHERE id=p_id AND workspace_id=nazir.current_workspace_id();
  RETURN safe_body;
 END IF;
 RAISE EXCEPTION 'Your role cannot do this.';
END $$;
REVOKE ALL ON FUNCTION nazir.read_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.read_report(uuid) TO nazir_app;
-- Redacted copy. Quotes, evidence and hidden cases are already absent from the stored viewer copy.
CREATE FUNCTION nazir.read_report_viewer(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE copy jsonb;
BEGIN
 IF NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 SELECT viewer_body INTO copy FROM nazir.reports WHERE id=p_id AND workspace_id=nazir.current_workspace_id();
 RETURN copy;
END $$;
REVOKE ALL ON FUNCTION nazir.read_report_viewer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.read_report_viewer(uuid) TO nazir_app;
