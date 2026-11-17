-- Contain the sink without deleting historical evidence or restoring run-wide attribution.
BEGIN;
REVOKE EXECUTE ON FUNCTION nazir.safety_canary_hit(text,text) FROM nazir_ingest;
COMMIT;
