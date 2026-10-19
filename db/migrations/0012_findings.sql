ALTER TABLE nazir.findings DROP CONSTRAINT findings_check_layer_check;
ALTER TABLE nazir.findings ADD CHECK(check_layer IN ('deterministic','record','semantic','human'));
ALTER TABLE nazir.findings ADD COLUMN check_id text, ADD COLUMN attempt int CHECK(attempt>0),
 ADD COLUMN language text CHECK(language IN ('en','ar')), ADD COLUMN title_ar text, ADD COLUMN really_happened_ar text,
 ADD UNIQUE(workspace_id,conversation_id,check_id);
-- Existing legacy writers remain valid. Every n13 run must write complete findings.
CREATE FUNCTION nazir.finding_required() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF EXISTS(SELECT FROM nazir.runs WHERE id=NEW.run_id AND runner_version='n13') AND (
  coalesce(btrim(NEW.check_id),'')='' OR NEW.attempt IS NULL OR NEW.language IS NULL OR coalesce(btrim(NEW.title_ar),'')='' OR coalesce(btrim(NEW.really_happened_ar),'')=''
 ) THEN RAISE EXCEPTION 'Finding fields required'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.finding_required() FROM PUBLIC;
CREATE TRIGGER finding_required BEFORE INSERT ON nazir.findings FOR EACH ROW EXECUTE FUNCTION nazir.finding_required();
CREATE FUNCTION nazir.finding_visible(p_scenario uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer') OR
 (nazir.member_has_role('supplier_maintainer') AND EXISTS(SELECT FROM nazir.scenarios WHERE id=p_scenario AND workspace_id=nazir.current_workspace_id() AND split='development'))
$$;
REVOKE ALL ON FUNCTION nazir.finding_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.finding_visible(uuid) TO nazir_app;
CREATE POLICY finding_read_scope ON nazir.findings AS RESTRICTIVE FOR SELECT TO nazir_app USING(nazir.finding_visible(scenario_id));
-- Viewers receive an explicit projection through this function, never evidence bodies.
CREATE FUNCTION nazir.read_findings() RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT CASE WHEN nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer') OR nazir.member_has_role('supplier_maintainer') THEN to_jsonb(f)
 ELSE jsonb_build_object('id',f.id,'workspace_id',f.workspace_id,'run_id',f.run_id,'conversation_id',f.conversation_id,'check_id',f.check_id,'language',f.language,'title',f.title,'title_ar',f.title_ar,'really_happened',f.really_happened,'really_happened_ar',f.really_happened_ar,'severity',f.severity,'status',f.status,'owner_role',f.owner_role,'root_cause_class',f.root_cause_class) END
 FROM nazir.findings f JOIN nazir.scenarios s ON s.id=f.scenario_id
 WHERE f.workspace_id=nazir.current_workspace_id() AND (nazir.finding_visible(f.scenario_id) OR (nazir.member_has_role('viewer') AND NOT nazir.member_can_work() AND s.split='development'))
$$;
REVOKE ALL ON FUNCTION nazir.read_findings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.read_findings() TO nazir_app;
CREATE FUNCTION nazir.n13_manifest_hash() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NEW.runner_version='n13' THEN NEW.manifest_hash:=encode(sha256(convert_to(nazir.runner_canonical(NEW.frozen_manifest),'UTF8')),'hex'); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.n13_manifest_hash() FROM PUBLIC;
CREATE TRIGGER zz_n13_manifest_hash BEFORE INSERT ON nazir.runs FOR EACH ROW EXECUTE FUNCTION nazir.n13_manifest_hash();
