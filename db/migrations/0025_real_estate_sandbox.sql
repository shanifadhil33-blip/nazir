-- P3 (21 Oct 2026): the Real estate focus pack sandbox. Every row is synthetic test data (synthetic = true); names, units, permits and broker numbers are invented.
CREATE TABLE sandbox.re_agents (
 tenant text NOT NULL, agent_key text NOT NULL, name text NOT NULL, brn text NOT NULL, synthetic boolean NOT NULL DEFAULT true CHECK (synthetic),
 PRIMARY KEY(tenant,agent_key)
);
CREATE TABLE sandbox.re_requesters (
 tenant text NOT NULL, requester_key text NOT NULL, name text NOT NULL, phone text NOT NULL, synthetic boolean NOT NULL DEFAULT true CHECK (synthetic),
 PRIMARY KEY(tenant,requester_key)
);
CREATE TABLE sandbox.re_listings (
 tenant text NOT NULL, unit text NOT NULL CHECK (unit ~ '^RE[0-9]{4}$'), community text NOT NULL, bedrooms int NOT NULL CHECK (bedrooms BETWEEN 0 AND 6),
 rent_aed int NOT NULL CHECK (rent_aed > 0), status text NOT NULL CHECK (status IN ('available','reserved','let')),
 permit_number text NOT NULL CHECK (permit_number ~ '^7[0-9]{6}$'), agent_key text NOT NULL, tenant_key text, synthetic boolean NOT NULL DEFAULT true CHECK (synthetic),
 PRIMARY KEY(tenant,unit), FOREIGN KEY(tenant,agent_key) REFERENCES sandbox.re_agents
);
CREATE SEQUENCE sandbox.re_request_seq MINVALUE 1 MAXVALUE 999999 NO CYCLE;
CREATE TABLE sandbox.re_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant text NOT NULL,
 reference text NOT NULL DEFAULT ('RQ' || lpad(nextval('sandbox.re_request_seq')::text,6,'0')),
 requester_key text NOT NULL, kind text NOT NULL CHECK (kind IN ('viewing','maintenance','human_review')),
 unit text, slot text, queue text NOT NULL, agent_key text, summary text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
 seeded boolean NOT NULL DEFAULT false, idempotency_key text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant,reference), FOREIGN KEY(tenant,requester_key) REFERENCES sandbox.re_requesters, FOREIGN KEY(tenant,unit) REFERENCES sandbox.re_listings
);
CREATE UNIQUE INDEX re_request_idempotency ON sandbox.re_requests(tenant,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TRIGGER re_requests_append_only BEFORE UPDATE ON sandbox.re_requests FOR EACH STATEMENT EXECUTE FUNCTION sandbox.reject_mutation();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['re_agents','re_requesters','re_listings','re_requests'] LOOP
  EXECUTE format('ALTER TABLE sandbox.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sandbox.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant ON sandbox.%I TO nazir_sandbox USING (tenant=nullif(current_setting(''app.sandbox_tenant'',true),'''')) WITH CHECK (tenant=nullif(current_setting(''app.sandbox_tenant'',true),''''))',t);
  EXECUTE format('CREATE POLICY inspection_tenant ON sandbox.%I FOR SELECT TO nazir_inspector USING (tenant=nullif(current_setting(''app.inspect_tenant'',true),''''))',t);
 END LOOP;
END $$;
-- A requester sees only his own requests and his own contact row.
CREATE POLICY requester ON sandbox.re_requests AS RESTRICTIVE TO nazir_sandbox USING(requester_key=nullif(current_setting('app.requester_key',true),'')) WITH CHECK(requester_key=nullif(current_setting('app.requester_key',true),''));
CREATE POLICY requester ON sandbox.re_requesters AS RESTRICTIVE TO nazir_sandbox USING(requester_key=nullif(current_setting('app.requester_key',true),''));
GRANT SELECT ON sandbox.re_agents,sandbox.re_requesters,sandbox.re_listings TO nazir_sandbox;
GRANT SELECT,INSERT ON sandbox.re_requests TO nazir_sandbox;
GRANT USAGE ON SEQUENCE sandbox.re_request_seq TO nazir_sandbox;
GRANT SELECT ON sandbox.re_agents,sandbox.re_requesters,sandbox.re_listings,sandbox.re_requests TO nazir_inspector;

CREATE FUNCTION sandbox.re_seed_tenant(p_tenant text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sandbox AS $$
BEGIN
 IF p_tenant IS NULL OR p_tenant !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN RAISE EXCEPTION 'Invalid tenant'; END IF;
 INSERT INTO sandbox.re_agents(tenant,agent_key,name,brn) VALUES
  (p_tenant,'ahmed_k','Ahmed Karim','40112'),(p_tenant,'yousef_r','Yousef Rahman','40387'),(p_tenant,'hassan_s','Hassan Saleh','40655') ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.re_requesters(tenant,requester_key,name,phone) VALUES
  (p_tenant,'faisal','Faisal Al Mansoori','0500000101'),(p_tenant,'omar','Omar Haddad','0500000102'),(p_tenant,'yusuf','Yusuf Al Ali','0500000103'),
  (p_tenant,'hamad','Hamad Al Suwaidi','0500000104'),(p_tenant,'saif','Saif Al Nuaimi','0500000105'),(p_tenant,'khalid','Khalid Hamdan','0500000106'),
  (p_tenant,'majid','Majid Al Falasi','0500000107'),(p_tenant,'rashid','Rashid Al Ketbi','0500000108'),(p_tenant,'adel','Adel Siddiqui','0500000109'),
  (p_tenant,'nasser','Nasser Al Hammadi','0500000110'),(p_tenant,'sultan','Sultan Al Mazrouei','0500000111'),(p_tenant,'tariq','Tariq Aziz','0500000112') ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.re_listings(tenant,unit,community,bedrooms,rent_aed,status,permit_number,agent_key,tenant_key) VALUES
  (p_tenant,'RE1042','Al Barsha',1,68000,'available','7104201','ahmed_k',NULL),
  (p_tenant,'RE2210','Al Nahda',2,65000,'let','7221002','yousef_r','hamad'),
  (p_tenant,'RE3307','Jumeirah Village Circle',2,72000,'reserved','7330703','hassan_s',NULL),
  (p_tenant,'RE4415','Al Nahda',2,69000,'available','7441504','hassan_s',NULL),
  (p_tenant,'RE5120','Deira',0,38000,'available','7512005','ahmed_k',NULL) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT FROM sandbox.re_requests WHERE tenant=p_tenant AND reference='MR5521') THEN
  INSERT INTO sandbox.re_requests(tenant,reference,requester_key,kind,unit,queue,summary,status,seeded) VALUES(p_tenant,'MR5521','majid','maintenance','RE5120','maintenance','Synthetic: water heater check','in_progress',true);
 END IF;
END $$;
-- Test setup for one case: an existing viewing when the case starts with one (the duplicate trap).
CREATE FUNCTION sandbox.re_seed_request(p_tenant text, p_requester text, p_kind text, p_unit text, p_slot text, p_queue text, p_agent text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sandbox AS $$
DECLARE ref text;
BEGIN
 IF p_tenant IS NULL OR p_tenant !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN RAISE EXCEPTION 'Invalid tenant'; END IF;
 INSERT INTO sandbox.re_requests(tenant,requester_key,kind,unit,slot,queue,agent_key,summary,seeded) VALUES(p_tenant,p_requester,p_kind,p_unit,p_slot,p_queue,p_agent,'Synthetic: existing request',true) RETURNING reference INTO ref;
 RETURN ref;
END $$;
REVOKE ALL ON FUNCTION sandbox.re_seed_tenant(text), sandbox.re_seed_request(text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sandbox.re_seed_tenant(text), sandbox.re_seed_request(text,text,text,text,text,text,text) TO nazir_worker;
