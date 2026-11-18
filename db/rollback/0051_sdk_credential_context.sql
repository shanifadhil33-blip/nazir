-- Contain uploads while preserving safe historical evidence. Never restore unguarded credential storage.
BEGIN;
REVOKE EXECUTE ON FUNCTION nazir.ingest_spans(text,text,jsonb,text),nazir.sdk_trace_context(text,text) FROM nazir_ingest;
COMMIT;
