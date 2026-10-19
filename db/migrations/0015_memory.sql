-- N16 memory: lesson effects, suggestions, history with effects, plans and findings that name lessons.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname, conrelid::regclass::text AS t FROM pg_constraint
  WHERE contype='c' AND conrelid IN ('nazir.lessons'::regclass,'nazir.lesson_revisions'::regclass) AND pg_get_constraintdef(oid) LIKE '%waiting_approval%' LOOP
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.t, c.conname);
 END LOOP;
END $$;
ALTER TABLE nazir.lessons ADD CHECK(status IN ('active','waiting_approval','rejected','deleted','suggested'));
ALTER TABLE nazir.lesson_revisions ADD CHECK(status_before IN ('active','waiting_approval','rejected','deleted','suggested'));
ALTER TABLE nazir.lesson_revisions ADD CHECK(status_after IN ('active','waiting_approval','rejected','deleted','suggested'));
ALTER TABLE nazir.lessons ADD COLUMN text_ar text, ADD COLUMN effect jsonb, ADD COLUMN family text,
 ADD COLUMN source_finding_ids uuid[] NOT NULL DEFAULT '{}', ADD COLUMN language text CHECK(language IN ('en','ar')),
 ADD COLUMN created_by uuid, ADD FOREIGN KEY(workspace_id,created_by) REFERENCES nazir.members(workspace_id,id);
ALTER TABLE nazir.lesson_revisions ADD COLUMN effect_before jsonb, ADD COLUMN effect_after jsonb, ADD COLUMN text_ar_after text;
GRANT INSERT ON nazir.lesson_revisions TO nazir_app,nazir_worker;
-- The effect allowlist. Anything that would change an approved result, a permission, a record check or a verdict is refused.
CREATE FUNCTION nazir.lesson_effect_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE k text; keys text[];
BEGIN
 IF TG_OP='INSERT' AND current_setting('role',true)='nazir_app' THEN NEW.created_by:=nazir.current_member_id(); END IF;
 IF TG_OP='UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Author is immutable'; END IF;
 IF NEW.effect IS NULL THEN RETURN NEW; END IF;
 k:=NEW.effect->>'kind';
 SELECT array_agg(x ORDER BY x) INTO keys FROM jsonb_object_keys(NEW.effect) x;
 IF k='note' AND keys=ARRAY['kind'] THEN NULL;
 ELSIF k='test_first' AND keys=ARRAY['family','kind'] THEN NULL;
 ELSIF k='test_harder' AND keys=ARRAY['family','kind','repeats'] AND (NEW.effect->>'repeats') IN ('2','3') THEN NULL;
 ELSIF k='check_queue' AND keys=ARRAY['category','kind','queue'] AND (NEW.effect->>'category', NEW.effect->>'queue') IN (('complaint','complaint_review'),('suggestion','suggestions'),('information','general_information')) THEN NULL;
 ELSIF k='judge_note' AND keys=ARRAY['family','kind','note'] AND length(btrim(NEW.effect->>'note')) BETWEEN 3 AND 500 THEN NULL;
 ELSE RAISE EXCEPTION 'Lesson effect not allowed'; END IF;
 IF (k='judge_note') <> (NEW.scope='big') THEN RAISE EXCEPTION 'Lesson scope must match its effect'; END IF;
 IF k IN ('test_first','test_harder','judge_note') AND NEW.family IS DISTINCT FROM NEW.effect->>'family' THEN RAISE EXCEPTION 'Lesson family must match its effect'; END IF;
 IF NEW.scope='big' AND NEW.status='active' AND NEW.approved_by IS NULL THEN RAISE EXCEPTION 'Owner approval required'; END IF;
 -- Members: a big lesson becomes active only with a reasoned owner approval in this change, and an active big lesson cannot change its effect.
 IF TG_OP='UPDATE' AND current_setting('role',true)='nazir_app' AND NEW.scope='big' AND NEW.status='active' THEN
  IF NEW.effect IS DISTINCT FROM OLD.effect OR NEW.scope IS DISTINCT FROM OLD.scope THEN RAISE EXCEPTION 'Owner approval required'; END IF;
  IF OLD.status<>'active' AND NOT EXISTS(SELECT 1 FROM nazir.approvals a WHERE a.workspace_id=NEW.workspace_id AND a.subject_type='lesson' AND a.subject_id=NEW.id AND a.decision='approve' AND a.decided_by=nazir.current_member_id() AND a.decided_at>=OLD.updated_at) THEN
   RAISE EXCEPTION 'Owner approval required';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.lesson_effect_guard() FROM PUBLIC;
CREATE TRIGGER b_lesson_effect BEFORE INSERT OR UPDATE ON nazir.lessons FOR EACH ROW EXECUTE FUNCTION nazir.lesson_effect_guard();
-- Workers only suggest lessons; they never activate one.
CREATE POLICY worker_lesson_scope ON nazir.lessons AS RESTRICTIVE FOR INSERT TO nazir_worker WITH CHECK(status='suggested' AND created_by_type='nazir');
-- Plans record the lessons they used; findings name them.
ALTER TABLE nazir.plans ADD COLUMN lessons_used jsonb CHECK(lessons_used IS NULL OR jsonb_typeof(lessons_used)='array');
ALTER TABLE nazir.findings ADD COLUMN lessons_used jsonb CHECK(lessons_used IS NULL OR jsonb_typeof(lessons_used)='array');
CREATE POLICY worker_plan_scope ON nazir.plans AS RESTRICTIVE FOR INSERT TO nazir_worker WITH CHECK(status='proposed' AND proposed_by_type='nazir');
