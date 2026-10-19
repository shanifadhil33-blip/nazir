-- N17 version comparisons: stored, append only, workspace scoped.
CREATE TABLE nazir.comparisons (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 run_a_id uuid NOT NULL,
 run_b_id uuid NOT NULL,
 created_by uuid,
 comparer_version text NOT NULL CHECK(comparer_version='n17'),
 summary jsonb NOT NULL CHECK(jsonb_typeof(summary)='object'),
 pairs jsonb NOT NULL CHECK(jsonb_typeof(pairs)='array'),
 summary_hash text NOT NULL DEFAULT '',
 CHECK(run_a_id<>run_b_id),
 FOREIGN KEY(workspace_id,run_a_id) REFERENCES nazir.runs(workspace_id,id),
 FOREIGN KEY(workspace_id,run_b_id) REFERENCES nazir.runs(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES nazir.members(workspace_id,id)
);
CREATE INDEX ON nazir.comparisons(workspace_id,run_a_id);
CREATE INDEX ON nazir.comparisons(workspace_id,run_b_id);
ALTER TABLE nazir.comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.comparisons FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace ON nazir.comparisons TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
-- Raw rows are for owner and reviewer. Suppliers and viewers read the projection below.
CREATE POLICY comparison_read_scope ON nazir.comparisons AS RESTRICTIVE FOR SELECT TO nazir_app USING(nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer'));
CREATE POLICY comparison_write_scope ON nazir.comparisons AS RESTRICTIVE FOR INSERT TO nazir_app WITH CHECK(nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer'));
GRANT SELECT,INSERT ON nazir.comparisons TO nazir_app;
GRANT SELECT ON nazir.comparisons TO nazir_worker;
CREATE FUNCTION nazir.comparison_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true)='nazir_app' THEN NEW.created_by:=nazir.current_member_id(); END IF;
 IF NEW.created_by IS NULL THEN RAISE EXCEPTION 'Comparison author required'; END IF;
 IF (SELECT count(*) FROM nazir.runs WHERE workspace_id=NEW.workspace_id AND id IN (NEW.run_a_id,NEW.run_b_id) AND status IN ('passed','failed','inconclusive','cancelled'))<>2 THEN
  RAISE EXCEPTION 'Both runs must be finished';
 END IF;
 NEW.created_at:=clock_timestamp();
 NEW.summary_hash:=encode(sha256(convert_to(nazir.runner_canonical(jsonb_build_object('summary',NEW.summary,'pairs',NEW.pairs)),'UTF8')),'hex');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.comparison_insert() FROM PUBLIC;
CREATE TRIGGER comparison_insert BEFORE INSERT ON nazir.comparisons FOR EACH ROW EXECUTE FUNCTION nazir.comparison_insert();
CREATE FUNCTION nazir.comparison_frozen() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN RAISE EXCEPTION 'Comparisons cannot change'; END $$;
REVOKE ALL ON FUNCTION nazir.comparison_frozen() FROM PUBLIC;
CREATE TRIGGER comparison_frozen BEFORE UPDATE OR DELETE ON nazir.comparisons FOR EACH ROW EXECUTE FUNCTION nazir.comparison_frozen();
CREATE TRIGGER comparison_no_truncate BEFORE TRUNCATE ON nazir.comparisons FOR EACH STATEMENT EXECUTE FUNCTION nazir.comparison_frozen();
-- Supplier: development pairs only, hidden pairs as a count. Viewer: totals and sentences only.
CREATE FUNCTION nazir.read_comparisons() RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT CASE
  WHEN nazir.member_has_role('service_owner') OR nazir.member_has_role('quality_reviewer') THEN to_jsonb(c)
  WHEN nazir.member_has_role('supplier_maintainer') THEN jsonb_build_object('id',c.id,'created_at',c.created_at,'run_a_id',c.run_a_id,'run_b_id',c.run_b_id,'comparer_version',c.comparer_version,'summary_hash',c.summary_hash,
   'summary',(c.summary - 'byFamily') || jsonb_build_object('byFamily',coalesce((SELECT jsonb_agg(f) FROM jsonb_array_elements(c.summary->'byFamily') f WHERE f->>'split'='development'),'[]'::jsonb)),
   'pairs',coalesce((SELECT jsonb_agg(p) FROM jsonb_array_elements(c.pairs) p WHERE p->>'split'='development'),'[]'::jsonb),
   'hidden_pairs',(SELECT count(*) FROM jsonb_array_elements(c.pairs) p WHERE coalesce(p->>'split','')<>'development'))
  ELSE jsonb_build_object('id',c.id,'created_at',c.created_at,'comparer_version',c.comparer_version,'summary_hash',c.summary_hash,
   'summary',jsonb_build_object('totals',c.summary->'totals','byLanguage',c.summary->'byLanguage','sentences',c.summary->'sentences','settingsDiffer',c.summary->'settingsDiffer'))
 END
 FROM nazir.comparisons c
 WHERE c.workspace_id=nazir.current_workspace_id() AND (nazir.member_can_work() OR nazir.member_has_role('viewer'))
$$;
REVOKE ALL ON FUNCTION nazir.read_comparisons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.read_comparisons() TO nazir_app;
