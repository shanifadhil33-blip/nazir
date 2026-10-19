CREATE TABLE sandbox.tenant_faults (
 tenant text NOT NULL, tool text NOT NULL CHECK(tool='create_case'), PRIMARY KEY(tenant,tool)
);
ALTER TABLE sandbox.tenant_faults ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox.tenant_faults FORCE ROW LEVEL SECURITY;
GRANT SELECT ON sandbox.tenant_faults TO nazir_inspector;
CREATE POLICY inspection_tenant ON sandbox.tenant_faults FOR SELECT TO nazir_inspector
 USING(tenant=nullif(current_setting('app.inspect_tenant',true),''));
CREATE FUNCTION sandbox.case_insert_fault() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sandbox AS $$
BEGIN
 IF EXISTS(SELECT FROM sandbox.tenant_faults WHERE tenant=NEW.tenant AND tool='create_case') THEN RAISE EXCEPTION 'Tool unavailable'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sandbox.case_insert_fault() FROM PUBLIC;
CREATE TRIGGER case_insert_fault BEFORE INSERT ON sandbox.cases FOR EACH ROW EXECUTE FUNCTION sandbox.case_insert_fault();
CREATE FUNCTION sandbox.seed_tenant_state(p_tenant text,p_state jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sandbox AS $$
DECLARE c jsonb; n bigint; highest bigint:=0; last_n bigint;
BEGIN
 IF p_tenant IS NULL OR p_tenant !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN RAISE EXCEPTION 'Invalid tenant'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('seed:'||p_tenant));
 LOCK TABLE sandbox.cases IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT FROM sandbox.cases WHERE tenant=p_tenant) OR EXISTS(SELECT FROM sandbox.tool_receipts WHERE tenant=p_tenant) OR EXISTS(SELECT FROM sandbox.tenant_faults WHERE tenant=p_tenant) THEN RAISE EXCEPTION 'Tenant is not empty'; END IF;
 IF p_state='{}'::jsonb THEN RETURN; END IF;
 IF jsonb_typeof(p_state) IS DISTINCT FROM 'object' OR NOT (p_state ?& ARRAY['seed','cases','tool_failure']) OR (p_state-ARRAY['seed','cases','tool_failure'])<>'{}'::jsonb
 OR p_state->>'seed' IS DISTINCT FROM 'sandbox' OR jsonb_typeof(p_state->'cases') IS DISTINCT FROM 'array' OR p_state->>'tool_failure' IS NULL OR p_state->>'tool_failure' NOT IN ('none','create_case') THEN RAISE EXCEPTION 'Invalid starting state'; END IF;
 IF jsonb_array_length(p_state->'cases')>10 THEN RAISE EXCEPTION 'Too many cases'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_state->'cases') LOOP
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR NOT(c ?& ARRAY['requester_key','reference','category','queue','status','prior_request_ref']) OR (c-ARRAY['requester_key','reference','category','queue','status','prior_request_ref'])<>'{}'::jsonb
  OR jsonb_typeof(c->'requester_key') IS DISTINCT FROM 'string' OR c->>'requester_key' NOT IN ('saeed','imran')
  OR jsonb_typeof(c->'reference') IS DISTINCT FROM 'string' OR c->>'reference' !~ '^NZ-[0-9]{6}$'
  OR jsonb_typeof(c->'category') IS DISTINCT FROM 'string' OR c->>'category' NOT IN ('complaint','suggestion','information')
  OR jsonb_typeof(c->'queue') IS DISTINCT FROM 'string' OR length(btrim(c->>'queue'))=0 OR length(c->>'queue')>100
  OR jsonb_typeof(c->'status') IS DISTINCT FROM 'string' OR c->>'status' NOT IN ('open','in_review')
  OR jsonb_typeof(c->'prior_request_ref') NOT IN ('null','string') THEN RAISE EXCEPTION 'Invalid seeded case'; END IF;
  IF c->>'prior_request_ref' IS NOT NULL AND NOT EXISTS(SELECT FROM sandbox.prior_requests WHERE tenant=p_tenant AND reference=c->>'prior_request_ref') THEN RAISE EXCEPTION 'Unknown prior request'; END IF;
  INSERT INTO sandbox.cases(tenant,reference,requester_key,category,summary,prior_request_ref,queue,status)
  VALUES(p_tenant,c->>'reference',c->>'requester_key',c->>'category','Synthetic library case',c->>'prior_request_ref',c->>'queue',c->>'status');
  n:=substring(c->>'reference' FROM 4)::bigint; highest:=greatest(highest,n);
 END LOOP;
 -- Serialize seeders. nextval remains globally increasing even after rollback.
 PERFORM pg_advisory_xact_lock(710192031);
 SELECT last_value INTO last_n FROM sandbox.case_reference_seq;
 IF highest>=last_n THEN PERFORM setval('sandbox.case_reference_seq',greatest(1,highest),true); END IF;
 IF p_state->>'tool_failure'='create_case' THEN INSERT INTO sandbox.tenant_faults VALUES(p_tenant,'create_case'); END IF;
END $$;
REVOKE ALL ON FUNCTION sandbox.seed_tenant_state(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sandbox.seed_tenant_state(text,jsonb) TO nazir_worker;
CREATE FUNCTION nazir.runner_library_fixture_workspace() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT id FROM nazir.workspaces WHERE name='Nazir library fixture' ORDER BY created_at,id LIMIT 1
$$;
REVOKE ALL ON FUNCTION nazir.runner_library_fixture_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.runner_library_fixture_workspace() TO nazir_worker;
