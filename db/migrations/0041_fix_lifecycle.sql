-- Chunk 3. Fixes that finish: one open fix per wrong answer, test again tracked on the server, and fixes for your own agent.

-- What to change in your own agent's instructions (EN and AR). Built in sample fixes keep using patch.
ALTER TABLE nazir.proposals ADD COLUMN instruction jsonb, ADD COLUMN retest_run_id uuid;
ALTER TABLE nazir.proposals ADD FOREIGN KEY(workspace_id,retest_run_id) REFERENCES nazir.runs(workspace_id,id);

-- One open fix per wrong answer. Older duplicates are withdrawn (kept, never deleted), the newest open one stays.
-- New suggestions are serialized per wrong answer in the app (transaction lock), which returns the open one.
UPDATE nazir.proposals p SET status='withdrawn'
 WHERE p.status='proposed' AND EXISTS(SELECT FROM nazir.proposals q WHERE q.finding_id=p.finding_id AND q.workspace_id=p.workspace_id AND q.status='proposed' AND (q.created_at,q.id)>(p.created_at,p.id));
CREATE INDEX proposals_open_by_finding ON nazir.proposals(workspace_id,finding_id) WHERE status='proposed';

CREATE OR REPLACE FUNCTION nazir.proposal_required() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE f record; d record;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.title_ar IS NULL AND NEW.root_cause_class IS NULL THEN RETURN NEW; END IF;
  SELECT root_cause_class INTO f FROM nazir.findings WHERE id=NEW.finding_id AND workspace_id=NEW.workspace_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Finding not found'; END IF;
  IF NEW.root_cause_class IS DISTINCT FROM f.root_cause_class THEN RAISE EXCEPTION 'Cause must match the finding'; END IF;
  IF coalesce(btrim(NEW.title),'')='' OR coalesce(btrim(NEW.title_ar),'')='' OR coalesce(btrim(NEW.expected_benefit),'')='' OR coalesce(btrim(NEW.possible_regression),'')='' OR length(btrim(NEW.evidence))<3 THEN RAISE EXCEPTION 'Proposal fields required'; END IF;
  IF NEW.instruction IS NOT NULL AND (NEW.patch IS NOT NULL OR jsonb_typeof(NEW.instruction)<>'object' OR length(btrim(coalesce(NEW.instruction->>'en','')))<10 OR length(btrim(coalesce(NEW.instruction->>'ar','')))<10) THEN RAISE EXCEPTION 'Instruction change shape'; END IF;
  IF NEW.patch IS NOT NULL AND (jsonb_typeof(NEW.patch)<>'array' OR jsonb_array_length(NEW.patch) NOT BETWEEN 1 AND 5) THEN RAISE EXCEPTION 'Repair patch shape'; END IF;
  IF NEW.resulting_agent_version_id IS NOT NULL THEN RAISE EXCEPTION 'Proposal must start without a version'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.title_ar IS NULL AND OLD.root_cause_class IS NULL THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','resulting_agent_version_id','retest_run_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resulting_agent_version_id','retest_run_id']) THEN RAISE EXCEPTION 'Proposal content is immutable'; END IF;
 IF NEW.retest_run_id IS DISTINCT FROM OLD.retest_run_id THEN
  IF NEW.status<>'approved' OR NEW.retest_run_id IS NULL OR NOT EXISTS(SELECT FROM nazir.runs r WHERE r.id=NEW.retest_run_id AND r.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Test again needs an approved fix and a check in this workspace'; END IF;
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF OLD.status<>'proposed' THEN RAISE EXCEPTION 'Proposal already decided'; END IF;
  IF NEW.status IN ('approved','rejected') THEN
   SELECT * INTO d FROM nazir.approvals WHERE workspace_id=NEW.workspace_id AND subject_type='proposal' AND subject_id=NEW.id ORDER BY decided_at DESC,created_at DESC LIMIT 1;
   IF NOT FOUND OR d.decision<>(CASE NEW.status WHEN 'approved' THEN 'approve' ELSE 'reject' END) OR length(btrim(d.reason))<10 THEN RAISE EXCEPTION 'A decision reason of at least 10 characters is required'; END IF;
   IF d.decided_by IS NOT DISTINCT FROM OLD.proposed_by AND NOT nazir.solo_decider() THEN RAISE EXCEPTION 'Another reviewer must decide'; END IF;
   IF NOT EXISTS(SELECT FROM nazir.member_roles WHERE member_id=d.decided_by AND role='quality_reviewer') THEN RAISE EXCEPTION 'Reviewer required'; END IF;
   IF NEW.status='approved' AND NEW.patch IS NULL AND NEW.instruction IS NULL THEN RAISE EXCEPTION 'This cause needs a server side change, not a prompt change'; END IF;
  END IF;
 END IF;
 IF NEW.resulting_agent_version_id IS DISTINCT FROM OLD.resulting_agent_version_id THEN
  IF OLD.resulting_agent_version_id IS NOT NULL OR NEW.status<>'approved' OR current_setting('role',true)='nazir_app' THEN RAISE EXCEPTION 'Version comes only from an approved proposal'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- Whoever may test again (owner or reviewer) may link the test again check; every other change still needs the maintainer.
CREATE OR REPLACE FUNCTION nazir.enforce_member_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE mid uuid; owner_role boolean; reviewer boolean; supplier boolean; author uuid; scope_value text; subject_workspace uuid;
BEGIN
 IF current_setting('role',true)<>'nazir_app' THEN RETURN NEW; END IF;
 mid:=nazir.current_member_id(); owner_role:=nazir.member_has_role('service_owner'); reviewer:=nazir.member_has_role('quality_reviewer'); supplier:=nazir.member_has_role('supplier_maintainer');
 IF mid IS NULL THEN RAISE EXCEPTION 'Workspace context required'; END IF;
 IF TG_TABLE_NAME IN ('rule_pack_versions','scenarios','plans','agent_versions','adapters') THEN
  IF TG_OP='INSERT' THEN NEW.created_by:=mid;
  ELSIF NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Author is immutable'; END IF;
 END IF;
 IF NEW.workspace_id IS DISTINCT FROM nazir.current_workspace_id() THEN RAISE EXCEPTION 'row-level security' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='agent_versions' THEN
  IF NEW.kind='planted_fault' AND NOT owner_role THEN RAISE EXCEPTION 'Owner required'; END IF;
 END IF;
 IF TG_TABLE_NAME IN ('rule_pack_versions','scenarios','plans') THEN
  IF TG_OP='INSERT' THEN NEW.approved_by:=NULL; NEW.approved_at:=NULL;
  ELSIF NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
   IF NEW.status<>'approved' OR OLD.status='approved' THEN RAISE EXCEPTION 'Approval metadata is immutable'; END IF;
  END IF;
  IF TG_TABLE_NAME='plans' THEN
   IF TG_OP='INSERT' THEN NEW.proposed_by:=mid; NEW.proposed_by_type:='member';
   ELSIF NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR NEW.proposed_by_type IS DISTINCT FROM OLD.proposed_by_type THEN RAISE EXCEPTION 'Author is immutable'; END IF;
  END IF;
  IF NEW.status IN ('approved','retired') THEN
   IF TG_TABLE_NAME='rule_pack_versions' AND NOT owner_role THEN RAISE EXCEPTION 'Owner required'; END IF;
   IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    IF mid=NEW.created_by OR (TG_TABLE_NAME='plans' AND mid=(to_jsonb(NEW)->>'proposed_by')::uuid) THEN RAISE EXCEPTION 'Another member must decide'; END IF;
    IF NEW.status='approved' THEN NEW.approved_by:=mid; NEW.approved_at:=now(); END IF;
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='proposals' THEN
  IF TG_OP='INSERT' THEN NEW.proposed_by:=mid; NEW.proposed_by_type:='member'; END IF;
  IF TG_OP='UPDATE' THEN
   IF NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR NEW.proposed_by_type IS DISTINCT FROM OLD.proposed_by_type THEN RAISE EXCEPTION 'Author is immutable'; END IF;
   IF NEW.status IN ('approved','rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT reviewer OR (mid=OLD.proposed_by AND NOT nazir.solo_decider()) THEN RAISE EXCEPTION 'Another reviewer must decide'; END IF;
    IF NOT supplier AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'Supplier required'; END IF;
   ELSIF NOT supplier AND NOT ((owner_role OR reviewer) AND (to_jsonb(NEW)-'retest_run_id') IS NOT DISTINCT FROM (to_jsonb(OLD)-'retest_run_id')) THEN RAISE EXCEPTION 'Supplier required'; END IF;
  ELSIF NEW.status<>'proposed' THEN RAISE EXCEPTION 'Proposal must start proposed'; END IF;
 ELSIF TG_TABLE_NAME='findings' THEN
  IF NOT reviewer AND NOT (owner_role AND NEW.status='accepted') THEN RAISE EXCEPTION 'Reviewer required'; END IF;
 ELSIF TG_TABLE_NAME='lessons' THEN
  IF TG_OP='INSERT' THEN NEW.approved_by:=NULL; NEW.confirmed_by:=NULL;
  ELSE
   IF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    IF NEW.scope='big' AND NOT owner_role THEN RAISE EXCEPTION 'Owner required'; END IF;
    NEW.approved_by:=mid;
   END IF;
   IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
    IF NEW.scope<>'small' THEN RAISE EXCEPTION 'Small lesson required'; END IF;
    NEW.confirmed_by:=mid;
   END IF;
  END IF;
  IF NEW.scope='big' AND NEW.status='active' AND NOT owner_role THEN
   IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'active' OR OLD.scope IS DISTINCT FROM 'big' THEN RAISE EXCEPTION 'Owner required'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='approvals' THEN
  IF NEW.decided_by IS DISTINCT FROM mid THEN RAISE EXCEPTION 'Decision member mismatch'; END IF;
  CASE NEW.subject_type
   WHEN 'rule_pack_version' THEN SELECT workspace_id,created_by INTO subject_workspace,author FROM nazir.rule_pack_versions WHERE id=NEW.subject_id; IF NOT owner_role THEN RAISE EXCEPTION 'Owner required'; END IF;
   WHEN 'plan' THEN SELECT workspace_id,coalesce(created_by,proposed_by) INTO subject_workspace,author FROM nazir.plans WHERE id=NEW.subject_id; IF NOT (owner_role OR reviewer) THEN RAISE EXCEPTION 'Reviewer required'; END IF;
   WHEN 'scenario' THEN SELECT workspace_id,created_by INTO subject_workspace,author FROM nazir.scenarios WHERE id=NEW.subject_id; IF NOT reviewer THEN RAISE EXCEPTION 'Reviewer required'; END IF;
   WHEN 'proposal' THEN SELECT workspace_id,proposed_by INTO subject_workspace,author FROM nazir.proposals WHERE id=NEW.subject_id; IF NOT reviewer THEN RAISE EXCEPTION 'Reviewer required'; END IF;
   WHEN 'finding_override' THEN SELECT workspace_id INTO subject_workspace FROM nazir.findings WHERE id=NEW.subject_id; IF NOT reviewer THEN RAISE EXCEPTION 'Reviewer required'; END IF;
   WHEN 'release' THEN SELECT workspace_id INTO subject_workspace FROM nazir.runs WHERE id=NEW.subject_id; IF NOT owner_role THEN RAISE EXCEPTION 'Owner required'; END IF;
   WHEN 'lesson' THEN SELECT workspace_id,scope INTO subject_workspace,scope_value FROM nazir.lessons WHERE id=NEW.subject_id; IF NOT (owner_role OR (reviewer AND scope_value='small')) THEN RAISE EXCEPTION 'Owner required'; END IF;
  END CASE;
  IF subject_workspace IS DISTINCT FROM nazir.current_workspace_id() THEN RAISE EXCEPTION 'Subject not found'; END IF;
  IF author=mid AND NOT (NEW.subject_type='proposal' AND nazir.solo_decider()) THEN RAISE EXCEPTION 'Another member must decide'; END IF;
  SELECT display_name INTO NEW.decided_by_name_at_event FROM nazir.members WHERE id=mid;
  SELECT array_agg(role ORDER BY role) INTO NEW.decided_by_roles_at_event FROM nazir.member_roles WHERE member_id=mid;
 END IF;
 RETURN NEW;
END $$;

-- The list every device reads. Test again progress is read from the run itself, so nothing on a device can drift.
DROP FUNCTION nazir.list_proposals();
CREATE FUNCTION nazir.list_proposals() RETURNS TABLE(id uuid,finding_id uuid,status text,title text,title_ar text,created_at timestamptz,proposed_by_name text,decided_at timestamptz,decided_by_name text,
  mine boolean,own_agent boolean,instruction jsonb,expected_benefit text,finding_title text,finding_title_ar text,finding_language text,before_run_id uuid,
  retest_run_id uuid,retest_run_status text,retest_done int,retest_total int,retest_report_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN QUERY
  SELECT p.id,p.finding_id,p.status,p.title,p.title_ar,p.created_at,m.display_name,a.decided_at,a.decided_by_name_at_event,
   p.proposed_by IS NOT DISTINCT FROM nazir.current_member_id(),p.instruction IS NOT NULL,p.instruction,
   p.expected_benefit,f.title,f.title_ar,f.language,f.run_id,
   p.retest_run_id,r.status,
   (SELECT count(*)::int FROM nazir.conversations c WHERE c.run_id=r.id AND c.status IN ('passed','failed','inconclusive')),
   (SELECT count(*)::int FROM nazir.conversations c WHERE c.run_id=r.id),
   (SELECT rp.id FROM nazir.reports rp WHERE rp.run_id=r.id AND rp.workspace_id=p.workspace_id ORDER BY rp.created_at DESC LIMIT 1)
  FROM nazir.proposals p
  LEFT JOIN nazir.members m ON m.id=p.proposed_by AND m.workspace_id=p.workspace_id
  LEFT JOIN nazir.findings f ON f.id=p.finding_id AND f.workspace_id=p.workspace_id
  LEFT JOIN nazir.runs r ON r.id=p.retest_run_id AND r.workspace_id=p.workspace_id
  LEFT JOIN LATERAL (SELECT x.decided_at,x.decided_by_name_at_event FROM nazir.approvals x WHERE x.workspace_id=p.workspace_id AND x.subject_type='proposal' AND x.subject_id=p.id ORDER BY x.decided_at DESC,x.created_at DESC LIMIT 1) a ON true
  WHERE p.workspace_id=nazir.current_workspace_id() AND p.title_ar IS NOT NULL AND p.status<>'withdrawn'
  ORDER BY p.created_at DESC,p.id LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION nazir.list_proposals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.list_proposals() TO nazir_app;
