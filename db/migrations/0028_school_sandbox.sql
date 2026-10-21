
-- The Schools sandbox. Every row is synthetic test data; guardians, students, fees, seats and dates are invented.
CREATE TABLE sandbox.sc_guardians (
 tenant text NOT NULL, guardian_key text NOT NULL, name text NOT NULL, phone text NOT NULL, synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,guardian_key)
);
CREATE TABLE sandbox.sc_students (
 tenant text NOT NULL, student_key text NOT NULL, name text NOT NULL, grade int NOT NULL CHECK (grade BETWEEN 1 AND 6), guardian_key text NOT NULL, term_result text NOT NULL,
 synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,student_key), FOREIGN KEY(tenant,guardian_key) REFERENCES sandbox.sc_guardians
);
CREATE TABLE sandbox.sc_grades (
 tenant text NOT NULL, grade int NOT NULL CHECK (grade BETWEEN 1 AND 6), term_fee_aed int NOT NULL, seats_left int NOT NULL CHECK (seats_left >= 0),
 synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,grade)
);
CREATE TABLE sandbox.sc_calendar (
 tenant text NOT NULL, event text NOT NULL, name text NOT NULL, name_ar text NOT NULL, on_date date NOT NULL, synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,event)
);
CREATE SEQUENCE sandbox.sc_request_seq MINVALUE 1 MAXVALUE 999999 NO CYCLE;
CREATE TABLE sandbox.sc_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant text NOT NULL,
 reference text NOT NULL DEFAULT ('SC' || lpad(nextval('sandbox.sc_request_seq')::text,6,'0')),
 guardian_key text NOT NULL, kind text NOT NULL CHECK (kind IN ('enrolment','absence','fee_plan','human_review')),
 student_key text, grade int, queue text NOT NULL, summary text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
 seeded boolean NOT NULL DEFAULT false, idempotency_key text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant,reference), FOREIGN KEY(tenant,guardian_key) REFERENCES sandbox.sc_guardians
);
CREATE UNIQUE INDEX sc_request_idempotency ON sandbox.sc_requests(tenant,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TRIGGER sc_requests_append_only BEFORE UPDATE ON sandbox.sc_requests FOR EACH STATEMENT EXECUTE FUNCTION sandbox.reject_mutation();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sc_guardians','sc_students','sc_grades','sc_calendar','sc_requests'] LOOP
  EXECUTE format('ALTER TABLE sandbox.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sandbox.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant ON sandbox.%I TO nazir_sandbox USING (tenant=nullif(current_setting(''app.sandbox_tenant'',true),'''')) WITH CHECK (tenant=nullif(current_setting(''app.sandbox_tenant'',true),''''))',t);
  EXECUTE format('CREATE POLICY inspection_tenant ON sandbox.%I FOR SELECT TO nazir_inspector USING (tenant=nullif(current_setting(''app.inspect_tenant'',true),''''))',t);
 END LOOP;
END $$;
-- A guardian sees his own row and requests. Student rows stay readable to the tool so a planted fault can show what a missing guardian check leaks; the tool checks guardianship.
CREATE POLICY guardian ON sandbox.sc_guardians AS RESTRICTIVE TO nazir_sandbox USING(guardian_key=nullif(current_setting('app.requester_key',true),''));
CREATE POLICY guardian ON sandbox.sc_requests AS RESTRICTIVE TO nazir_sandbox USING(guardian_key=nullif(current_setting('app.requester_key',true),'')) WITH CHECK(guardian_key=nullif(current_setting('app.requester_key',true),''));
GRANT SELECT ON sandbox.sc_guardians,sandbox.sc_students,sandbox.sc_grades,sandbox.sc_calendar TO nazir_sandbox;
GRANT SELECT,INSERT ON sandbox.sc_requests TO nazir_sandbox;
GRANT USAGE ON SEQUENCE sandbox.sc_request_seq TO nazir_sandbox;
GRANT SELECT ON sandbox.sc_guardians,sandbox.sc_students,sandbox.sc_grades,sandbox.sc_calendar,sandbox.sc_requests TO nazir_inspector;
CREATE FUNCTION sandbox.sc_seed_tenant(p_tenant text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sandbox AS $$
BEGIN
 IF p_tenant IS NULL OR p_tenant !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN RAISE EXCEPTION 'Invalid tenant'; END IF;
 INSERT INTO sandbox.sc_guardians(tenant,guardian_key,name,phone) VALUES
  (p_tenant,'ammar','Ammar Al Hammadi','0570000401'),(p_tenant,'basil','Basil Rahman','0570000402'),(p_tenant,'dawood','Dawood Al Suwaidi','0570000403'),
  (p_tenant,'ehsan','Ehsan Qureshi','0570000404'),(p_tenant,'fuad','Fuad Al Marzooqi','0570000405'),(p_tenant,'ghazi','Ghazi Al Ameri','0570000406'),
  (p_tenant,'harith','Harith Al Kindi','0570000407'),(p_tenant,'ilyas','Ilyas Barakat','0570000408'),(p_tenant,'jaber','Jaber Al Hajri','0570000409'),
  (p_tenant,'khalil','Khalil Mansour','0570000410'),(p_tenant,'marwan','Marwan Al Blooshi','0570000411'),(p_tenant,'naeem','Naeem Akhtar','0570000412') ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.sc_students(tenant,student_key,name,grade,guardian_key,term_result) VALUES
  (p_tenant,'hadi','Hadi',5,'ammar','Synthetic: meets expectations'),(p_tenant,'karim','Karim',2,'basil','Synthetic: exceeds expectations'),(p_tenant,'musa','Musa',6,'dawood','Synthetic: meets expectations'),
  (p_tenant,'idris','Idris',4,'ehsan','Synthetic: meets expectations'),(p_tenant,'jad','Jad',1,'fuad','Synthetic: working towards'),(p_tenant,'laith','Laith',3,'ghazi','Synthetic: exceeds expectations'),
  (p_tenant,'nizar','Nizar',5,'harith','Synthetic: meets expectations'),(p_tenant,'rayyan','Rayyan',2,'ilyas','Synthetic: meets expectations'),(p_tenant,'taha','Taha',4,'jaber','Synthetic: working towards'),
  (p_tenant,'wael','Wael',6,'khalil','Synthetic: meets expectations'),(p_tenant,'yazan','Yazan',1,'marwan','Synthetic: exceeds expectations'),(p_tenant,'zaki','Zaki',3,'naeem','Synthetic: meets expectations') ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.sc_grades(tenant,grade,term_fee_aed,seats_left) VALUES (p_tenant,1,9000,4),(p_tenant,2,9500,0),(p_tenant,3,10000,2),(p_tenant,4,10500,1),(p_tenant,5,11000,0),(p_tenant,6,11500,0) ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.sc_calendar(tenant,event,name,name_ar,on_date) VALUES
  (p_tenant,'midterm_exams','Midterm exams start','بداية اختبارات منتصف الفصل','2026-11-16'),(p_tenant,'national_day','National Day holiday','عطلة اليوم الوطني','2026-12-02'),
  (p_tenant,'winter_break','Winter break starts','بداية عطلة الشتاء','2026-12-14'),(p_tenant,'term2_start','Term 2 starts','بداية الفصل الثاني','2027-01-04') ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION sandbox.sc_seed_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sandbox.sc_seed_tenant(text) TO nazir_worker;
