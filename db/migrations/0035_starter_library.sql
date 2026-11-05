-- A new workspace has no approved rules and no approved tests, so its first Quick check could not start ("There is no approved version to test").
-- The Government tests and rules ship with the product, so Nazir installs them as approved on the first Start, for the service owner only.
-- Worker role only: the app code checks the person first, then switches role. A member can never call this directly, and it does nothing
-- for a workspace that already has approved tests.
CREATE FUNCTION nazir.worker_install_starter(p_requested_by uuid,p_rules jsonb,p_items jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE wid uuid:=nazir.current_workspace_id(); pack uuid; item jsonb; mid uuid; n integer:=0; pv uuid;
BEGIN
 IF current_setting('role',true)<>'nazir_worker' OR wid IS NULL THEN RAISE EXCEPTION 'Worker context required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nazir.member_roles WHERE member_id=p_requested_by AND workspace_id=wid AND role='service_owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF jsonb_typeof(p_rules)<>'object' OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Starter library shape'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(wid::text||':starter',0));
 IF EXISTS(SELECT 1 FROM nazir.scenarios WHERE workspace_id=wid AND status='approved') THEN RETURN 0; END IF;
 INSERT INTO nazir.rule_packs(workspace_id,key,title) VALUES(wid,'government_rules','Government service rules') ON CONFLICT(workspace_id,key) DO NOTHING;
 SELECT id INTO pack FROM nazir.rule_packs WHERE workspace_id=wid AND key='government_rules';
 IF NOT EXISTS(SELECT 1 FROM nazir.rule_pack_versions WHERE rule_pack_id=pack AND version=1) THEN
  INSERT INTO nazir.rule_pack_versions(workspace_id,rule_pack_id,version,content,status,approved_at) VALUES(wid,pack,1,p_rules,'approved',now());
 END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
  IF EXISTS(SELECT 1 FROM nazir.scenarios WHERE workspace_id=wid AND stable_key=item->>'stable_key') THEN CONTINUE; END IF;
  SELECT id INTO mid FROM nazir.scenario_meanings WHERE workspace_id=wid AND canonical=(item->'canonical') AND family=item->>'family' LIMIT 1;
  IF mid IS NULL THEN INSERT INTO nazir.scenario_meanings(workspace_id,family,canonical) VALUES(wid,item->>'family',item->'canonical') RETURNING id INTO mid; END IF;
  INSERT INTO nazir.scenarios(workspace_id,meaning_id,stable_key,version,family,language,split,persona,starting_state,allowed_actions,forbidden_actions,expected_state,source_clause,expectation_kind,severity,rubric_version,resident_turns,checks,source,library_hash,status,approved_at)
   VALUES(wid,mid,item->>'stable_key',1,item->>'family',item->>'language',item->>'split',item->'persona',item->'starting_state',
    ARRAY(SELECT jsonb_array_elements_text(item->'allowed_actions')),ARRAY(SELECT jsonb_array_elements_text(item->'forbidden_actions')),item->'expected_state',item->>'source_clause',item->>'expectation_kind',item->>'severity',item->>'rubric_version',
    item->'resident_turns',ARRAY(SELECT jsonb_array_elements_text(item->'checks')),'authored',item->>'library_hash','approved',now());
  n:=n+1;
 END LOOP;
 PERFORM nazir.append_audit('library.starter_installed','workspace',wid::text,jsonb_build_object('requested_by',p_requested_by,'scenarios',n));
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION nazir.worker_install_starter(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.worker_install_starter(uuid,jsonb,jsonb) TO nazir_worker;
