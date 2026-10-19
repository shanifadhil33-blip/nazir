CREATE SCHEMA sandbox;
REVOKE ALL ON SCHEMA sandbox FROM PUBLIC;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nazir_sandbox') THEN CREATE ROLE nazir_sandbox NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA sandbox TO nazir_sandbox,nazir_worker;
CREATE TABLE sandbox.requesters (
 tenant text NOT NULL, requester_key text NOT NULL, name text NOT NULL,
 PRIMARY KEY(tenant,requester_key)
);
CREATE TABLE sandbox.prior_requests (
 tenant text NOT NULL, reference text NOT NULL, requester_key text NOT NULL,
 status text NOT NULL CHECK(status IN ('unresolved','resolved')), summary text NOT NULL,
 PRIMARY KEY(tenant,reference), FOREIGN KEY(tenant,requester_key) REFERENCES sandbox.requesters
);
CREATE SEQUENCE sandbox.case_reference_seq MINVALUE 1 MAXVALUE 999999 NO CYCLE;
CREATE TABLE sandbox.cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant text NOT NULL,
 reference text NOT NULL DEFAULT ('NZ-' || lpad(nextval('sandbox.case_reference_seq')::text,6,'0')) CHECK(reference ~ '^NZ-[0-9]{6}$'),
 requester_key text NOT NULL, category text NOT NULL CHECK(category IN ('complaint','suggestion','information')),
 summary text NOT NULL, prior_request_ref text, queue text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review')),
 idempotency_key text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant,reference), UNIQUE(tenant,id),
 FOREIGN KEY(tenant,requester_key) REFERENCES sandbox.requesters,
 FOREIGN KEY(tenant,prior_request_ref) REFERENCES sandbox.prior_requests
);
CREATE UNIQUE INDEX case_idempotency ON sandbox.cases(tenant,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE sandbox.escalations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant text NOT NULL, case_id uuid NOT NULL UNIQUE,
 queue text NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'pending_review' CHECK(status='pending_review'),
 idempotency_key text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant,case_id) REFERENCES sandbox.cases(tenant,id)
);
CREATE UNIQUE INDEX escalation_idempotency ON sandbox.escalations(tenant,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE sandbox.tool_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant text NOT NULL, tool text NOT NULL,
 request jsonb NOT NULL, response jsonb NOT NULL, outcome text NOT NULL CHECK(outcome IN ('ok','error')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION sandbox.reject_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Record is append only'; END $$;
CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE OR TRUNCATE ON sandbox.tool_receipts FOR EACH STATEMENT EXECUTE FUNCTION sandbox.reject_mutation();
CREATE FUNCTION sandbox.case_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.status<>'open' OR NEW.status<>'in_review' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'Case transition refused'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_transition BEFORE UPDATE ON sandbox.cases FOR EACH ROW EXECUTE FUNCTION sandbox.case_transition();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['requesters','prior_requests','cases','escalations','tool_receipts'] LOOP
  EXECUTE format('ALTER TABLE sandbox.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sandbox.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant ON sandbox.%I TO nazir_sandbox USING (tenant=nullif(current_setting(''app.sandbox_tenant'',true),'''')) WITH CHECK (tenant=nullif(current_setting(''app.sandbox_tenant'',true),''''))',t);
 END LOOP;
END $$;
CREATE POLICY requester ON sandbox.cases AS RESTRICTIVE TO nazir_sandbox USING(requester_key=nullif(current_setting('app.requester_key',true),'')) WITH CHECK(requester_key=nullif(current_setting('app.requester_key',true),''));
CREATE POLICY requester ON sandbox.escalations AS RESTRICTIVE TO nazir_sandbox USING(EXISTS(SELECT FROM sandbox.cases c WHERE c.tenant=escalations.tenant AND c.id=case_id)) WITH CHECK(EXISTS(SELECT FROM sandbox.cases c WHERE c.tenant=escalations.tenant AND c.id=case_id));
GRANT SELECT ON sandbox.requesters,sandbox.prior_requests TO nazir_sandbox;
GRANT SELECT,INSERT ON sandbox.cases,sandbox.escalations,sandbox.tool_receipts TO nazir_sandbox;
GRANT UPDATE(status) ON sandbox.cases TO nazir_sandbox;
GRANT USAGE ON SEQUENCE sandbox.case_reference_seq TO nazir_sandbox;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sandbox FROM PUBLIC;
CREATE FUNCTION sandbox.seed_tenant(p_tenant text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sandbox AS $$
BEGIN
 IF p_tenant IS NULL OR p_tenant !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN RAISE EXCEPTION 'Invalid tenant'; END IF;
 INSERT INTO sandbox.requesters VALUES(p_tenant,'saeed','Saeed Al Hashimi'),(p_tenant,'imran','Imran Qureshi') ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.prior_requests VALUES
 (p_tenant,'SR-1042','saeed','unresolved','Delayed permit renewal'),
 (p_tenant,'SR-2077','imran','unresolved','Missing document review') ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION sandbox.seed_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sandbox.seed_tenant(text) TO nazir_worker;
