CREATE FUNCTION nazir.current_member_id() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'nazir_app' THEN RETURN NULL; END IF;
 RETURN (SELECT id FROM nazir.members WHERE id=nullif(current_setting('app.member_id',true),'')::uuid AND status='active');
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;
CREATE FUNCTION nazir.member_has_role(wanted text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT EXISTS(SELECT FROM nazir.member_roles WHERE member_id=nazir.current_member_id() AND role=wanted)
$$;
CREATE FUNCTION nazir.member_can_work() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT nazir.member_has_role('service_owner') OR nazir.member_has_role('supplier_maintainer') OR nazir.member_has_role('quality_reviewer')
$$;
REVOKE ALL ON FUNCTION nazir.current_member_id(),nazir.member_has_role(text),nazir.member_can_work() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.current_member_id(),nazir.member_has_role(text),nazir.member_can_work() TO nazir_app,nazir_worker;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['rule_pack_versions','scenarios','plans','agent_versions','adapters'] LOOP
  EXECUTE format('ALTER TABLE nazir.%I ADD COLUMN created_by uuid, ADD FOREIGN KEY(workspace_id,created_by) REFERENCES nazir.members(workspace_id,id)',t);
 END LOOP;
END $$;
CREATE FUNCTION nazir.meaning_is_visible(meaning uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer') OR (
  nazir.member_has_role('supplier_maintainer') AND EXISTS(SELECT FROM nazir.scenarios WHERE workspace_id=nazir.current_workspace_id() AND meaning_id=meaning AND split='development')
  AND NOT EXISTS(SELECT FROM nazir.scenarios WHERE workspace_id=nazir.current_workspace_id() AND meaning_id=meaning AND split='hidden'))
$$;
REVOKE ALL ON FUNCTION nazir.meaning_is_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.meaning_is_visible(uuid) TO nazir_app;

-- Restrictive policies intersect the existing workspace boundary, never widen it.
DO $$ DECLARE t text; allowed text; BEGIN
 FOREACH t IN ARRAY ARRAY['rule_packs','rule_pack_versions','agents','agent_versions','adapters','scenario_meanings','scenarios','plans','proposals','findings','lessons','lesson_revisions','approvals'] LOOP
  allowed:=CASE
   WHEN t='adapters' THEN 'nazir.member_has_role(''supplier_maintainer'')'
   WHEN t IN ('rule_packs','rule_pack_versions','agents','agent_versions') THEN '(nazir.member_has_role(''supplier_maintainer'') OR nazir.member_has_role(''service_owner''))'
   WHEN t IN ('scenario_meanings','scenarios','plans','lessons','lesson_revisions','findings') THEN '(nazir.member_has_role(''quality_reviewer'') OR nazir.member_has_role(''service_owner''))'
   WHEN t='proposals' THEN 'nazir.member_has_role(''supplier_maintainer'')'
   ELSE 'nazir.member_can_work()' END;
  EXECUTE format('CREATE POLICY role_insert ON nazir.%I AS RESTRICTIVE FOR INSERT TO nazir_app WITH CHECK (%s)',t,allowed);
  IF t='proposals' THEN allowed:='nazir.member_can_work()'; END IF;
  EXECUTE format('CREATE POLICY role_update ON nazir.%I AS RESTRICTIVE FOR UPDATE TO nazir_app USING (%s) WITH CHECK (%s)',t,allowed,allowed);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['conversation_messages','tool_events','state_readings','adapters','agent_versions','scenarios','scenario_meanings','plans','proposals','lessons','lesson_revisions','audit_events','conversations'] LOOP
  EXECUTE format('CREATE POLICY role_read ON nazir.%I AS RESTRICTIVE FOR SELECT TO nazir_app USING (nazir.member_can_work())',t);
 END LOOP;
END $$;
CREATE POLICY version_read ON nazir.rule_pack_versions AS RESTRICTIVE FOR SELECT TO nazir_app USING(status='approved' OR nazir.member_can_work());
CREATE POLICY hidden_read ON nazir.scenarios AS RESTRICTIVE FOR SELECT TO nazir_app USING(split<>'hidden' OR nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer'));
CREATE POLICY meaning_read ON nazir.scenario_meanings AS RESTRICTIVE FOR SELECT TO nazir_app USING(nazir.meaning_is_visible(id));
CREATE POLICY approval_read ON nazir.approvals AS RESTRICTIVE FOR SELECT TO nazir_app USING(subject_type='release' OR nazir.member_can_work());
REVOKE INSERT ON nazir.approvals FROM nazir_worker;

CREATE FUNCTION nazir.enforce_member_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
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
    IF NOT reviewer OR mid=OLD.proposed_by THEN RAISE EXCEPTION 'Another reviewer must decide'; END IF;
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
  IF author=mid THEN RAISE EXCEPTION 'Another member must decide'; END IF;
  SELECT display_name INTO NEW.decided_by_name_at_event FROM nazir.members WHERE id=mid;
  SELECT array_agg(role ORDER BY role) INTO NEW.decided_by_roles_at_event FROM nazir.member_roles WHERE member_id=mid;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.enforce_member_write() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['rule_pack_versions','scenarios','plans','agent_versions','adapters','proposals','findings','lessons','approvals'] LOOP
  EXECUTE format('CREATE TRIGGER a_member_write BEFORE INSERT OR UPDATE ON nazir.%I FOR EACH ROW EXECUTE FUNCTION nazir.enforce_member_write()',t);
 END LOOP;
END $$;
ALTER FUNCTION nazir.append_audit(text,text,text,jsonb) RENAME TO append_audit_internal;
REVOKE ALL ON FUNCTION nazir.append_audit_internal(text,text,text,jsonb) FROM nazir_app,nazir_worker;
CREATE FUNCTION nazir.append_audit(action text,target_type text,target_id text,payload jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true)='nazir_app' AND nazir.current_workspace_id() IS NOT NULL AND NOT nazir.member_can_work() THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 PERFORM nazir.append_audit_internal(action,target_type,target_id,payload);
END $$;
REVOKE ALL ON FUNCTION nazir.append_audit(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.append_audit(text,text,text,jsonb) TO nazir_app,nazir_worker;

-- Worker provisioning has no app grant. The workspace always comes from its context.
CREATE FUNCTION nazir.add_member(p_email text,p_display_name text,p_roles text[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE wid uuid; uid uuid; mid uuid; role_value text;
BEGIN
 IF current_setting('role',true)<>'nazir_worker' THEN RAISE EXCEPTION 'Worker role required'; END IF;
 wid:=nazir.current_workspace_id();
 IF wid IS NULL THEN RAISE EXCEPTION 'Workspace context required'; END IF;
 IF p_roles IS NULL OR cardinality(p_roles)=0 OR NOT p_roles <@ ARRAY['service_owner','supplier_maintainer','quality_reviewer','viewer']::text[] OR array_position(p_roles,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Choose a role'; END IF;
 INSERT INTO nazir.users(email,name) VALUES(lower(p_email),p_display_name) ON CONFLICT(email) DO UPDATE SET name=excluded.name RETURNING id INTO uid;
 INSERT INTO nazir.members(workspace_id,user_id,display_name) VALUES(wid,uid,p_display_name) RETURNING id INTO mid;
 FOREACH role_value IN ARRAY p_roles LOOP
  INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES(wid,mid,role_value) ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM nazir.append_audit('member.created','member',mid::text,'{}');
 RETURN mid;
END $$;
REVOKE ALL ON FUNCTION nazir.add_member(text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.add_member(text,text,text[]) TO nazir_worker;

-- Author metadata is excluded from scenario content, preserving hashes of applied rows.
CREATE OR REPLACE FUNCTION nazir.guard_content() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, nazir AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Identity is immutable'; END IF;
  IF TG_TABLE_NAME IN ('rule_pack_versions','scenarios') THEN
   IF OLD.status IN ('approved','retired') THEN
   IF NEW.status NOT IN ('approved','retired') OR (OLD.status='retired' AND NEW.status<>'retired') OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'Approved content is immutable'; END IF;
   END IF;
  ELSIF TG_TABLE_NAME='agent_versions' THEN
   IF OLD.frozen_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Frozen version is immutable'; END IF;
  ELSIF TG_TABLE_NAME='runs' THEN
   IF NEW.frozen_manifest IS DISTINCT FROM OLD.frozen_manifest OR NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash THEN RAISE EXCEPTION 'Manifest is immutable'; END IF;
  ELSIF TG_TABLE_NAME='findings' AND (to_jsonb(NEW)-ARRAY['status','owner_role']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','owner_role']) THEN RAISE EXCEPTION 'Finding evidence is immutable';
  END IF;
 END IF;
 CASE TG_TABLE_NAME
 WHEN 'rule_pack_versions' THEN NEW.content_hash:=encode(sha256(convert_to(NEW.content::text,'UTF8')),'hex');
 WHEN 'agent_versions' THEN NEW.config_hash:=encode(sha256(convert_to(NEW.config::text,'UTF8')),'hex');
 WHEN 'adapters' THEN NEW.manifest_hash:=encode(sha256(convert_to(NEW.tool_manifest::text,'UTF8')),'hex');
 WHEN 'scenarios' THEN NEW.content_hash:=encode(sha256(convert_to((to_jsonb(NEW)-ARRAY['id','workspace_id','created_at','content_hash','status','approved_by','approved_at','created_by'])::text,'UTF8')),'hex');
 WHEN 'runs' THEN NEW.manifest_hash:=encode(sha256(convert_to(NEW.frozen_manifest::text,'UTF8')),'hex');
 WHEN 'tool_events' THEN NEW.payload_hash:=encode(sha256(convert_to(jsonb_build_object('request',NEW.request,'response',NEW.response)::text,'UTF8')),'hex');
 WHEN 'state_readings' THEN NEW.reading_hash:=encode(sha256(convert_to(NEW.reading::text,'UTF8')),'hex');
 ELSE NULL;
 END CASE;
 RETURN NEW;
END $$;

