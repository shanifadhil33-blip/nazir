-- Existing data keeps its original single attempt meaning.
ALTER TABLE nazir.runs ADD COLUMN repeat_count int NOT NULL DEFAULT 1 CHECK(repeat_count BETWEEN 1 AND 3);
ALTER TABLE nazir.plans ADD COLUMN repeat_count int NOT NULL DEFAULT 3 CHECK(repeat_count BETWEEN 1 AND 3);
-- Separate the test attempt from the lease recovery attempt already on conversations.
ALTER TABLE nazir.conversations ADD COLUMN attempt_number int NOT NULL DEFAULT 1 CHECK(attempt_number BETWEEN 1 AND 3);
-- Attempt links keep finding evidence immutable and make counting idempotent.
CREATE TABLE nazir.finding_attempts (
 workspace_id uuid NOT NULL,
 finding_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,finding_id,conversation_id),
 FOREIGN KEY(workspace_id,finding_id) REFERENCES nazir.findings(workspace_id,id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES nazir.conversations(workspace_id,id)
);
ALTER TABLE nazir.finding_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.finding_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace ON nazir.finding_attempts TO nazir_worker
 USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
CREATE POLICY member_read ON nazir.finding_attempts FOR SELECT TO nazir_app
 USING(workspace_id=nazir.current_workspace_id() AND EXISTS(SELECT FROM nazir.findings f WHERE f.id=finding_id));
REVOKE ALL ON nazir.finding_attempts FROM PUBLIC;
GRANT SELECT,INSERT ON nazir.finding_attempts TO nazir_worker;
GRANT SELECT ON nazir.finding_attempts TO nazir_app;
CREATE OR REPLACE FUNCTION nazir.read_findings() RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT CASE WHEN nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer') OR nazir.member_has_role('supplier_maintainer') THEN to_jsonb(f)
 ELSE jsonb_build_object('id',f.id,'workspace_id',f.workspace_id,'run_id',f.run_id,'conversation_id',f.conversation_id,'check_id',f.check_id,'language',f.language,'title',f.title,'title_ar',f.title_ar,'really_happened',f.really_happened,'really_happened_ar',f.really_happened_ar,'severity',f.severity,'status',f.status,'owner_role',f.owner_role,'root_cause_class',f.root_cause_class) END || jsonb_build_object('failed_attempts',greatest(1,(SELECT count(*) FROM nazir.finding_attempts a WHERE a.finding_id=f.id)))
 FROM nazir.findings f JOIN nazir.scenarios s ON s.id=f.scenario_id
 WHERE f.workspace_id=nazir.current_workspace_id() AND (nazir.finding_visible(f.scenario_id) OR (nazir.member_has_role('viewer') AND NOT nazir.member_can_work() AND s.split='development'))
$$;
REVOKE ALL ON FUNCTION nazir.read_findings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.read_findings() TO nazir_app;
