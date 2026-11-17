-- Emergency containment if ownership setup fails after 0048. Run as database owner.
-- Keep all evidence and new columns. Do not restore the old unverified ownership behavior.
-- Deploy the corrected server, then regrant these exact functions from migration0048.
BEGIN;
REVOKE EXECUTE ON FUNCTION nazir.safety_start(text,text,text,text,jsonb),nazir.safety_confirm(uuid,text),nazir.safety_confirm(text) FROM nazir_app;
COMMIT;
