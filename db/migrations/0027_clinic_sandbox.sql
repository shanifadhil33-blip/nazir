-- Chunk 4 (21 Oct 2026): the Clinics sandbox. Every row is synthetic test data (synthetic = true); patients, doctors, insurers and fees are invented.
CREATE TABLE sandbox.cl_doctors (
 tenant text NOT NULL, doctor_key text NOT NULL, name text NOT NULL, clinic text NOT NULL CHECK (clinic IN ('general','dermatology','orthopaedics')), on_leave boolean NOT NULL,
 synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,doctor_key)
);
CREATE TABLE sandbox.cl_insurers (
 tenant text NOT NULL, insurer text NOT NULL, name text NOT NULL, service text NOT NULL, covered boolean NOT NULL, copay_percent int NOT NULL CHECK (copay_percent BETWEEN 0 AND 100),
 synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,insurer,service)
);
CREATE TABLE sandbox.cl_patients (
 tenant text NOT NULL, patient_key text NOT NULL, name text NOT NULL, phone text NOT NULL, insurer text NOT NULL, lab_released boolean NOT NULL DEFAULT false, prescription text,
 synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,patient_key)
);
CREATE TABLE sandbox.cl_fees (
 tenant text NOT NULL, service text NOT NULL, price_aed int NOT NULL CHECK (price_aed > 0), synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,service)
);
CREATE TABLE sandbox.cl_slots (
 tenant text NOT NULL, slot text NOT NULL CHECK (slot ~ '^SL[0-9]{3}$'), doctor_key text NOT NULL, day text NOT NULL, time text NOT NULL, status text NOT NULL CHECK (status IN ('open','booked','blocked')),
 synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,slot), FOREIGN KEY(tenant,doctor_key) REFERENCES sandbox.cl_doctors
);
CREATE SEQUENCE sandbox.cl_request_seq MINVALUE 1 MAXVALUE 999999 NO CYCLE;
CREATE TABLE sandbox.cl_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant text NOT NULL,
 reference text NOT NULL DEFAULT ('CL' || lpad(nextval('sandbox.cl_request_seq')::text,6,'0')),
 patient_key text NOT NULL, kind text NOT NULL CHECK (kind IN ('appointment','cancellation','refill','human_review')),
 slot text, target text, queue text NOT NULL, summary text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','done')),
 seeded boolean NOT NULL DEFAULT false, idempotency_key text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant,reference), FOREIGN KEY(tenant,patient_key) REFERENCES sandbox.cl_patients, FOREIGN KEY(tenant,slot) REFERENCES sandbox.cl_slots
);
CREATE UNIQUE INDEX cl_request_idempotency ON sandbox.cl_requests(tenant,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TRIGGER cl_requests_append_only BEFORE UPDATE ON sandbox.cl_requests FOR EACH STATEMENT EXECUTE FUNCTION sandbox.reject_mutation();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cl_doctors','cl_insurers','cl_patients','cl_fees','cl_slots','cl_requests'] LOOP
  EXECUTE format('ALTER TABLE sandbox.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sandbox.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant ON sandbox.%I TO nazir_sandbox USING (tenant=nullif(current_setting(''app.sandbox_tenant'',true),'''')) WITH CHECK (tenant=nullif(current_setting(''app.sandbox_tenant'',true),''''))',t);
  EXECUTE format('CREATE POLICY inspection_tenant ON sandbox.%I FOR SELECT TO nazir_inspector USING (tenant=nullif(current_setting(''app.inspect_tenant'',true),''''))',t);
 END LOOP;
END $$;
-- A patient sees only his own row and his own requests. Slot status is public; who booked it is not.
CREATE POLICY patient ON sandbox.cl_patients AS RESTRICTIVE TO nazir_sandbox USING(patient_key=nullif(current_setting('app.requester_key',true),''));
CREATE POLICY patient ON sandbox.cl_requests AS RESTRICTIVE TO nazir_sandbox USING(patient_key=nullif(current_setting('app.requester_key',true),'')) WITH CHECK(patient_key=nullif(current_setting('app.requester_key',true),''));
GRANT SELECT ON sandbox.cl_doctors,sandbox.cl_insurers,sandbox.cl_patients,sandbox.cl_fees,sandbox.cl_slots TO nazir_sandbox;
GRANT SELECT,INSERT ON sandbox.cl_requests TO nazir_sandbox;
GRANT USAGE ON SEQUENCE sandbox.cl_request_seq TO nazir_sandbox;
GRANT SELECT ON sandbox.cl_doctors,sandbox.cl_insurers,sandbox.cl_patients,sandbox.cl_fees,sandbox.cl_slots,sandbox.cl_requests TO nazir_inspector;

CREATE FUNCTION sandbox.cl_seed_tenant(p_tenant text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sandbox AS $$
BEGIN
 IF p_tenant IS NULL OR p_tenant !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN RAISE EXCEPTION 'Invalid tenant'; END IF;
 INSERT INTO sandbox.cl_doctors(tenant,doctor_key,name,clinic,on_leave) VALUES
  (p_tenant,'faris','Dr Faris Haddad','general',false),(p_tenant,'nadim','Dr Nadim Saleh','dermatology',true),
  (p_tenant,'ziyad','Dr Ziyad Karam','dermatology',false),(p_tenant,'samir','Dr Samir Aziz','orthopaedics',false) ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.cl_insurers(tenant,insurer,name,service,covered,copay_percent) VALUES
  (p_tenant,'gold','Falcon Health Gold','general',true,10),(p_tenant,'gold','Falcon Health Gold','dermatology',true,20),(p_tenant,'gold','Falcon Health Gold','orthopaedics',true,20),
  (p_tenant,'basic','Falcon Health Basic','general',true,20),(p_tenant,'basic','Falcon Health Basic','dermatology',false,100),(p_tenant,'basic','Falcon Health Basic','orthopaedics',false,100) ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.cl_patients(tenant,patient_key,name,phone,insurer,lab_released,prescription) VALUES
  (p_tenant,'adnan','Adnan Farouk','0560000301','gold',false,NULL),(p_tenant,'hussain','Hussain Al Ali','0560000302','gold',false,NULL),
  (p_tenant,'imad','Imad Nasser','0560000303','gold',true,NULL),(p_tenant,'kamal','Kamal Yousef','0560000304','basic',false,'Synthetic repeat prescription RX-77'),
  (p_tenant,'luqman','Luqman Al Hashimi','0560000305','basic',false,NULL),(p_tenant,'nabil','Nabil Saeed','0560000306','basic',false,NULL),
  (p_tenant,'qais','Qais Al Mazrouei','0560000307','gold',false,NULL),(p_tenant,'rami','Rami Al Qasimi','0560000308','gold',false,NULL),
  (p_tenant,'sami','Sami Haidar','0560000309','gold',false,NULL),(p_tenant,'tahir','Tahir Mahmood','0560000310','basic',false,NULL),
  (p_tenant,'yahya','Yahya Al Tamimi','0560000311','gold',false,NULL),(p_tenant,'hamdan','Hamdan Al Nuaimi','0560000312','gold',false,NULL) ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.cl_fees(tenant,service,price_aed) VALUES (p_tenant,'general',300),(p_tenant,'dermatology',450),(p_tenant,'orthopaedics',500),(p_tenant,'lab',150) ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.cl_slots(tenant,slot,doctor_key,day,time,status) VALUES
  (p_tenant,'SL101','faris','Sunday','09:00','open'),(p_tenant,'SL102','faris','Sunday','10:00','booked'),(p_tenant,'SL103','faris','Monday','10:00','booked'),
  (p_tenant,'SL104','faris','Monday','11:00','open'),(p_tenant,'SL201','nadim','Tuesday','11:00','blocked'),(p_tenant,'SL301','ziyad','Wednesday','16:00','open'),
  (p_tenant,'SL401','samir','Thursday','12:00','booked'),(p_tenant,'SL402','samir','Thursday','13:00','open') ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT FROM sandbox.cl_requests WHERE tenant=p_tenant AND seeded) THEN
  INSERT INTO sandbox.cl_requests(tenant,reference,patient_key,kind,slot,queue,summary,status,seeded) VALUES
   (p_tenant,'AP1002','hussain','appointment','SL102','appointments','Synthetic: general check','booked',true),
   (p_tenant,'AP1003','rami','appointment','SL401','appointments','Synthetic: knee review','booked',true),
   (p_tenant,'AP1004','qais','appointment','SL103','appointments','Synthetic: follow up','booked',true);
 END IF;
END $$;
REVOKE ALL ON FUNCTION sandbox.cl_seed_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sandbox.cl_seed_tenant(text) TO nazir_worker;
CREATE OR REPLACE FUNCTION nazir.scenario_pack(p_state jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE p_state->>'seed' WHEN 'estate_sandbox' THEN 'real_estate' WHEN 'shop_sandbox' THEN 'ecommerce' WHEN 'clinic_sandbox' THEN 'clinics' WHEN 'school_sandbox' THEN 'schools' ELSE 'government' END
$$;

