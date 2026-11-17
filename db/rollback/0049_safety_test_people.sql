-- Emergency containment for 0049. Retains encrypted settings and historical evidence.
-- Deploy the prior application and review the cause before restoring these grants.
BEGIN;
REVOKE EXECUTE ON FUNCTION nazir.save_safety_test_people(uuid,jsonb,text),nazir.read_safety_test_people(),nazir.safety_start(text,text,text,text,jsonb,uuid) FROM nazir_app;
COMMIT;
