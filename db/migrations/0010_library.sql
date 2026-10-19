ALTER TABLE nazir.scenarios
 ADD COLUMN resident_turns jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(resident_turns)='array'),
 ADD COLUMN checks text[] NOT NULL DEFAULT '{}',
 ADD COLUMN source text NOT NULL DEFAULT 'authored' CHECK(source IN ('authored','generated')),
 ADD COLUMN library_hash text;
-- Meaning content is versioned with its scenarios. Fix exposure lives separately
-- so recording exposure never changes approved scenario content or hashes.
CREATE TABLE nazir.library_fix_usage (
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 meaning_id uuid NOT NULL,
 used_by uuid NOT NULL,
 used_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,meaning_id),
 FOREIGN KEY(workspace_id,meaning_id) REFERENCES nazir.scenario_meanings(workspace_id,id),
 FOREIGN KEY(workspace_id,used_by) REFERENCES nazir.members(workspace_id,id)
);
ALTER TABLE nazir.library_fix_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.library_fix_usage FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON nazir.library_fix_usage TO nazir_app;
CREATE POLICY member_usage ON nazir.library_fix_usage TO nazir_app
 USING(workspace_id=nazir.current_workspace_id() AND (nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer')))
 WITH CHECK(workspace_id=nazir.current_workspace_id() AND used_by=nazir.current_member_id() AND (nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer')));
CREATE FUNCTION nazir.freeze_library_meaning() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF EXISTS(SELECT FROM nazir.scenarios WHERE meaning_id=OLD.id AND status IN ('approved','retired')) AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Approved meaning is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER freeze_library_meaning BEFORE UPDATE ON nazir.scenario_meanings FOR EACH ROW EXECUTE FUNCTION nazir.freeze_library_meaning();
REVOKE ALL ON FUNCTION nazir.freeze_library_meaning() FROM PUBLIC;
CREATE FUNCTION nazir.library_draft() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.source='generated' AND NEW.status<>'draft' THEN RAISE EXCEPTION 'Generated cases start as drafts'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER library_draft BEFORE INSERT ON nazir.scenarios FOR EACH ROW EXECUTE FUNCTION nazir.library_draft();
REVOKE ALL ON FUNCTION nazir.library_draft() FROM PUBLIC;
