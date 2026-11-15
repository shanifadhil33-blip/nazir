-- Chunk 2. One person does the whole job: check, suggest a fix, approve it and test it again.
-- The four database roles, RLS and workspace isolation stay. A workspace owner now holds all three flow roles,
-- and while the workspace is solo (one person, or the demo) that person may approve their own fix.

ALTER TABLE nazir.workspaces ADD COLUMN solo boolean NOT NULL DEFAULT true;
ALTER TABLE nazir.approvals ADD COLUMN self_approved boolean NOT NULL DEFAULT false;

-- Solo: the setting is on and only one person works here. The demo workspace is one person (Omar) in the app.
CREATE FUNCTION nazir.solo_decider() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT coalesce((SELECT w.solo AND (w.id='d0000000-0000-4000-8000-000000000100'::uuid OR (SELECT count(*) FROM nazir.members m WHERE m.workspace_id=w.id AND m.status='active')=1)
   FROM nazir.workspaces w WHERE w.id=nazir.current_workspace_id()),false)
$$;
REVOKE ALL ON FUNCTION nazir.solo_decider() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.solo_decider() TO nazir_app, nazir_worker;

-- The decision row says when a person approved their own fix. Computed here, never sent by the app.
CREATE FUNCTION nazir.approval_self_flag() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 NEW.self_approved:=NEW.subject_type='proposal' AND EXISTS(SELECT FROM nazir.proposals p WHERE p.id=NEW.subject_id AND p.workspace_id=NEW.workspace_id AND p.proposed_by=NEW.decided_by);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.approval_self_flag() FROM PUBLIC;
CREATE TRIGGER c_approval_self_flag BEFORE INSERT ON nazir.approvals FOR EACH ROW EXECUTE FUNCTION nazir.approval_self_flag();

-- New real owners get the reviewer and maintainer roles with their owner role.
CREATE FUNCTION nazir.owner_holds_flow_roles() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NEW.role='service_owner' AND EXISTS(SELECT FROM nazir.workspaces w WHERE w.id=NEW.workspace_id AND w.kind='real') THEN
  INSERT INTO nazir.member_roles(workspace_id,member_id,role)
   SELECT NEW.workspace_id,NEW.member_id,r FROM unnest(ARRAY['quality_reviewer','supplier_maintainer']) r
   WHERE NOT EXISTS(SELECT FROM nazir.member_roles x WHERE x.member_id=NEW.member_id AND x.role=r);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION nazir.owner_holds_flow_roles() FROM PUBLIC;
CREATE TRIGGER owner_holds_flow_roles AFTER INSERT ON nazir.member_roles FOR EACH ROW EXECUTE FUNCTION nazir.owner_holds_flow_roles();

-- Existing real owners, and Omar in the demo.
INSERT INTO nazir.member_roles(workspace_id,member_id,role)
 SELECT o.workspace_id,o.member_id,r FROM nazir.member_roles o JOIN nazir.workspaces w ON w.id=o.workspace_id
 CROSS JOIN unnest(ARRAY['quality_reviewer','supplier_maintainer']) r
 WHERE o.role='service_owner' AND (w.kind='real' OR w.id='d0000000-0000-4000-8000-000000000100')
  AND NOT EXISTS(SELECT FROM nazir.member_roles x WHERE x.member_id=o.member_id AND x.role=r);

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
   ELSIF NOT supplier THEN RAISE EXCEPTION 'Supplier required'; END IF;
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

CREATE OR REPLACE FUNCTION nazir.proposal_required() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE f record; d record;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.title_ar IS NULL AND NEW.root_cause_class IS NULL THEN RETURN NEW; END IF;
  SELECT root_cause_class INTO f FROM nazir.findings WHERE id=NEW.finding_id AND workspace_id=NEW.workspace_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Finding not found'; END IF;
  IF NEW.root_cause_class IS DISTINCT FROM f.root_cause_class THEN RAISE EXCEPTION 'Cause must match the finding'; END IF;
  IF coalesce(btrim(NEW.title),'')='' OR coalesce(btrim(NEW.title_ar),'')='' OR coalesce(btrim(NEW.expected_benefit),'')='' OR coalesce(btrim(NEW.possible_regression),'')='' OR length(btrim(NEW.evidence))<3 THEN RAISE EXCEPTION 'Proposal fields required'; END IF;
  IF NEW.patch IS NOT NULL AND (jsonb_typeof(NEW.patch)<>'array' OR jsonb_array_length(NEW.patch) NOT BETWEEN 1 AND 5) THEN RAISE EXCEPTION 'Repair patch shape'; END IF;
  IF NEW.resulting_agent_version_id IS NOT NULL THEN RAISE EXCEPTION 'Proposal must start without a version'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.title_ar IS NULL AND OLD.root_cause_class IS NULL THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','resulting_agent_version_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resulting_agent_version_id']) THEN RAISE EXCEPTION 'Proposal content is immutable'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF OLD.status<>'proposed' THEN RAISE EXCEPTION 'Proposal already decided'; END IF;
  IF NEW.status IN ('approved','rejected') THEN
   SELECT * INTO d FROM nazir.approvals WHERE workspace_id=NEW.workspace_id AND subject_type='proposal' AND subject_id=NEW.id ORDER BY decided_at DESC,created_at DESC LIMIT 1;
   IF NOT FOUND OR d.decision<>(CASE NEW.status WHEN 'approved' THEN 'approve' ELSE 'reject' END) OR length(btrim(d.reason))<10 THEN RAISE EXCEPTION 'A decision reason of at least 10 characters is required'; END IF;
   IF d.decided_by IS NOT DISTINCT FROM OLD.proposed_by AND NOT nazir.solo_decider() THEN RAISE EXCEPTION 'Another reviewer must decide'; END IF;
   IF NOT EXISTS(SELECT FROM nazir.member_roles WHERE member_id=d.decided_by AND role='quality_reviewer') THEN RAISE EXCEPTION 'Reviewer required'; END IF;
   IF NEW.status='approved' AND NEW.patch IS NULL THEN RAISE EXCEPTION 'This cause needs a server side change, not a prompt change'; END IF;
  END IF;
 END IF;
 IF NEW.resulting_agent_version_id IS DISTINCT FROM OLD.resulting_agent_version_id THEN
  IF OLD.resulting_agent_version_id IS NOT NULL OR NEW.status<>'approved' OR current_setting('role',true)='nazir_app' THEN RAISE EXCEPTION 'Version comes only from an approved proposal'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION nazir.repair_materialize(p_proposal uuid, p_executable_hash text, p_retest uuid[], p_suite uuid[], p_budget_retest int, p_budget_suite int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE wid uuid:=nazir.current_workspace_id(); p record; d record; f record; pv record; vid uuid; retest_id uuid; suite_id uuid; ids uuid[]; plan_ids uuid[]:='{}'; i int;
BEGIN
 IF current_setting('role',true)<>'nazir_worker' OR wid IS NULL THEN RAISE EXCEPTION 'Worker context required'; END IF;
 SELECT * INTO p FROM nazir.proposals WHERE id=p_proposal AND workspace_id=wid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Proposal not found'; END IF;
 IF p.status<>'approved' OR p.patch IS NULL OR p.title_ar IS NULL THEN RAISE EXCEPTION 'Approved repair proposal required'; END IF;
 IF p.resulting_agent_version_id IS NOT NULL THEN RAISE EXCEPTION 'Repair already created'; END IF;
 SELECT * INTO d FROM nazir.approvals WHERE workspace_id=wid AND subject_type='proposal' AND subject_id=p.id AND decision='approve' ORDER BY decided_at DESC LIMIT 1;
 IF NOT FOUND OR (d.decided_by IS NOT DISTINCT FROM p.proposed_by AND NOT nazir.solo_decider()) OR length(btrim(d.reason))<10 OR NOT EXISTS(SELECT FROM nazir.member_roles WHERE member_id=d.decided_by AND role='quality_reviewer') THEN RAISE EXCEPTION 'Reviewer approval required'; END IF;
 SELECT * INTO f FROM nazir.findings WHERE id=p.finding_id AND workspace_id=wid;
 SELECT * INTO pv FROM nazir.agent_versions WHERE id=f.agent_version_id AND workspace_id=wid;
 IF pv.config->>'registry_id' NOT IN ('baseline','planted_wrong_queue','planted_false_submit') THEN RAISE EXCEPTION 'Repair parent unknown'; END IF;
 IF p_budget_retest NOT BETWEEN 1 AND 400 OR p_budget_suite NOT BETWEEN 1 AND 800 THEN RAISE EXCEPTION 'Budget out of range'; END IF;
 IF coalesce(cardinality(p_retest),0)=0 OR coalesce(cardinality(p_suite),0)=0 OR cardinality(p_retest)<>(SELECT count(DISTINCT x) FROM unnest(p_retest) x) OR cardinality(p_suite)<>(SELECT count(DISTINCT x) FROM unnest(p_suite) x) THEN RAISE EXCEPTION 'Scenario lists required'; END IF;
 IF (SELECT count(*) FROM nazir.scenarios WHERE workspace_id=wid AND status='approved' AND id=ANY(p_retest))<>cardinality(p_retest)
  OR (SELECT count(*) FROM nazir.scenarios WHERE workspace_id=wid AND status='approved' AND id=ANY(p_suite))<>cardinality(p_suite) THEN RAISE EXCEPTION 'Approved scenarios required'; END IF;
 INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,config,config_hash,parent_version_id,frozen_at,created_by)
  VALUES(wid,pv.agent_id,'Repaired version','repair',jsonb_build_object('registry_id','repair','parent_registry_id',pv.config->>'registry_id','patch',p.patch,'executable_hash',p_executable_hash),'',pv.id,clock_timestamp(),p.proposed_by)
  RETURNING id INTO vid;
 FOR i IN 1..2 LOOP
  ids:=CASE i WHEN 1 THEN p_retest ELSE p_suite END;
  INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,status,proposed_by_type,proposed_by,approved_by,approved_at)
   SELECT wid,CASE i WHEN 1 THEN 'Retest of the approved repair' ELSE 'Frozen regression suite' END,vid,f.rule_pack_version_id,
    array_agg(DISTINCT s.family ORDER BY s.family),array_agg(DISTINCT s.language ORDER BY s.language),1,CASE i WHEN 1 THEN p_budget_retest ELSE p_budget_suite END,
    jsonb_build_object('set',CASE i WHEN 1 THEN 'retest' ELSE 'suite' END,'retest_of_proposal',p.id,'approval_id',d.id,'scenario_ids',to_jsonb(ids),'records_only',false),
    'approved','nazir',NULL,d.decided_by,d.decided_at
   FROM nazir.scenarios s WHERE s.workspace_id=wid AND s.id=ANY(ids)
   RETURNING id INTO retest_id;
  plan_ids:=plan_ids||retest_id;
 END LOOP;
 UPDATE nazir.proposals SET resulting_agent_version_id=vid WHERE id=p.id;
 PERFORM nazir.append_audit('agent_version.repair_created','agent_version',vid::text,jsonb_build_object('proposal_id',p.id,'parent_version_id',pv.id,'executable_hash',p_executable_hash,'approval_id',d.id));
 PERFORM nazir.append_audit('plan.retest_created','plan',plan_ids[1]::text,jsonb_build_object('proposal_id',p.id,'retest_plan_id',plan_ids[1],'suite_plan_id',plan_ids[2],'retest_count',cardinality(p_retest),'suite_count',cardinality(p_suite)));
 RETURN jsonb_build_object('version_id',vid,'retest_plan_id',plan_ids[1],'suite_plan_id',plan_ids[2]);
END $$;
