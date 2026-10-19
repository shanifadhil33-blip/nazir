DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nazir_inspector') THEN CREATE ROLE nazir_inspector NOLOGIN; END IF;
END $$;
ALTER ROLE nazir_inspector NOLOGIN;
REVOKE ALL ON SCHEMA sandbox,nazir FROM nazir_inspector;
REVOKE ALL ON ALL TABLES IN SCHEMA sandbox,nazir FROM nazir_inspector;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sandbox,nazir FROM nazir_inspector;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sandbox,nazir FROM nazir_inspector;
REVOKE ALL ON SCHEMA sandbox,nazir FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA sandbox,nazir FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sandbox,nazir FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sandbox,nazir FROM PUBLIC;
GRANT USAGE ON SCHEMA sandbox TO nazir_inspector;
GRANT SELECT ON sandbox.requesters,sandbox.prior_requests,sandbox.cases,sandbox.escalations,sandbox.tool_receipts TO nazir_inspector;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['requesters','prior_requests','cases','escalations','tool_receipts'] LOOP
  EXECUTE format('CREATE POLICY inspection_tenant ON sandbox.%I FOR SELECT TO nazir_inspector USING (tenant=nullif(current_setting(''app.inspect_tenant'',true),''''))',t);
 END LOOP;
END $$;
