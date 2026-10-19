-- N15 repair proposals, repaired agent versions and retest plans.
-- 1. Repaired versions: an exact repair config shape bound to its parent and its executable hash.
CREATE FUNCTION nazir.repair_version_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE keys text[];
BEGIN
 IF NEW.config->>'registry_id'='repair' THEN
  IF NEW.kind<>'repair' THEN RAISE EXCEPTION 'Registry kind mismatch'; END IF;
  SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(NEW.config) k;
  IF keys IS DISTINCT FROM ARRAY['executable_hash','parent_registry_id','patch','registry_id'] THEN RAISE EXCEPTION 'Repair config shape'; END IF;
  IF NEW.config->>'parent_registry_id' NOT IN ('baseline','planted_wrong_queue','planted_false_submit') THEN RAISE EXCEPTION 'Repair parent unknown'; END IF;
  IF coalesce(NEW.config->>'executable_hash','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Repair hash required'; END IF;
  IF jsonb_typeof(NEW.config->'patch')<>'array' OR jsonb_array_length(NEW.config->'patch') NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Repair patch required'; END IF;
  IF NEW.parent_version_id IS NULL OR NOT EXISTS(SELECT FROM nazir.agent_versions p WHERE p.id=NEW.parent_version_id AND p.workspace_id=NEW.workspace_id AND p.config->>'registry_id'=NEW.config->>'parent_registry_id') THEN RAISE EXCEPTION 'Repair parent mismatch'; END IF;
  IF NEW.frozen_at IS NULL THEN RAISE EXCEPTION 'Repair version must be frozen'; END IF;
  NEW.config_hash:=NEW.config->>'executable_hash';
 ELSIF TG_OP='INSERT' AND NEW.kind='repair' THEN RAISE EXCEPTION 'Repair config required';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.repair_version_guard() FROM PUBLIC;
CREATE TRIGGER zz_repair_version BEFORE INSERT OR UPDATE ON nazir.agent_versions FOR EACH ROW EXECUTE FUNCTION nazir.repair_version_guard();
-- Members never create repaired versions directly; only an approved proposal does, through repair_materialize.
CREATE POLICY repair_insert_scope ON nazir.agent_versions AS RESTRICTIVE FOR INSERT TO nazir_app WITH CHECK(kind<>'repair');

-- 2. Proposal content for new repair proposals. Older rows stay valid.
ALTER TABLE nazir.proposals ADD COLUMN title text, ADD COLUMN title_ar text, ADD COLUMN root_cause_class text,
 ADD COLUMN cause_note text, ADD COLUMN suggested_by_nazir boolean;
CREATE FUNCTION nazir.proposal_required() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
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
   IF d.decided_by IS NOT DISTINCT FROM OLD.proposed_by THEN RAISE EXCEPTION 'Another reviewer must decide'; END IF;
   IF NOT EXISTS(SELECT FROM nazir.member_roles WHERE member_id=d.decided_by AND role='quality_reviewer') THEN RAISE EXCEPTION 'Reviewer required'; END IF;
   IF NEW.status='approved' AND NEW.patch IS NULL THEN RAISE EXCEPTION 'This cause needs a server side change, not a prompt change'; END IF;
  END IF;
 END IF;
 IF NEW.resulting_agent_version_id IS DISTINCT FROM OLD.resulting_agent_version_id THEN
  IF OLD.resulting_agent_version_id IS NOT NULL OR NEW.status<>'approved' OR current_setting('role',true)='nazir_app' THEN RAISE EXCEPTION 'Version comes only from an approved proposal'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.proposal_required() FROM PUBLIC;
CREATE TRIGGER b_proposal_required BEFORE INSERT OR UPDATE ON nazir.proposals FOR EACH ROW EXECUTE FUNCTION nazir.proposal_required();

-- 3. Worker only: record that a finding's meaning was used to suggest a fix (twin exposure rule).
CREATE FUNCTION nazir.repair_mark_used(p_proposal uuid, p_member uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE wid uuid:=nazir.current_workspace_id(); m uuid;
BEGIN
 IF current_setting('role',true)<>'nazir_worker' OR wid IS NULL THEN RAISE EXCEPTION 'Worker context required'; END IF;
 SELECT s.meaning_id INTO m FROM nazir.proposals p JOIN nazir.findings f ON f.id=p.finding_id AND f.workspace_id=p.workspace_id JOIN nazir.scenarios s ON s.id=f.scenario_id AND s.workspace_id=f.workspace_id WHERE p.id=p_proposal AND p.workspace_id=wid;
 IF m IS NULL THEN RAISE EXCEPTION 'Proposal not found'; END IF;
 IF NOT EXISTS(SELECT FROM nazir.members WHERE id=p_member AND workspace_id=wid AND status='active') THEN RAISE EXCEPTION 'Member not found'; END IF;
 INSERT INTO nazir.library_fix_usage(workspace_id,meaning_id,used_by) VALUES(wid,m,p_member) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION nazir.repair_mark_used(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.repair_mark_used(uuid,uuid) TO nazir_worker;

-- 4. Worker only: turn an approved proposal into a frozen repaired version and two approved retest plans.
CREATE FUNCTION nazir.repair_materialize(p_proposal uuid, p_executable_hash text, p_retest uuid[], p_suite uuid[], p_budget_retest int, p_budget_suite int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE wid uuid:=nazir.current_workspace_id(); p record; d record; f record; pv record; vid uuid; retest_id uuid; suite_id uuid; ids uuid[]; plan_ids uuid[]:='{}'; i int;
BEGIN
 IF current_setting('role',true)<>'nazir_worker' OR wid IS NULL THEN RAISE EXCEPTION 'Worker context required'; END IF;
 SELECT * INTO p FROM nazir.proposals WHERE id=p_proposal AND workspace_id=wid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Proposal not found'; END IF;
 IF p.status<>'approved' OR p.patch IS NULL OR p.title_ar IS NULL THEN RAISE EXCEPTION 'Approved repair proposal required'; END IF;
 IF p.resulting_agent_version_id IS NOT NULL THEN RAISE EXCEPTION 'Repair already created'; END IF;
 SELECT * INTO d FROM nazir.approvals WHERE workspace_id=wid AND subject_type='proposal' AND subject_id=p.id AND decision='approve' ORDER BY decided_at DESC LIMIT 1;
 IF NOT FOUND OR d.decided_by IS NOT DISTINCT FROM p.proposed_by OR length(btrim(d.reason))<10 OR NOT EXISTS(SELECT FROM nazir.member_roles WHERE member_id=d.decided_by AND role='quality_reviewer') THEN RAISE EXCEPTION 'Reviewer approval required'; END IF;
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
REVOKE ALL ON FUNCTION nazir.repair_materialize(uuid,text,uuid[],uuid[],int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.repair_materialize(uuid,text,uuid[],uuid[],int,int) TO nazir_worker;
