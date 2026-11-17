-- Preserve the recent list and its safe projection; exact history links can read one older fix.
DROP FUNCTION nazir.list_proposals();
CREATE FUNCTION nazir.list_proposals(p_id uuid DEFAULT NULL) RETURNS TABLE(id uuid,finding_id uuid,status text,title text,title_ar text,created_at timestamptz,proposed_by_name text,decided_at timestamptz,decided_by_name text,
  mine boolean,own_agent boolean,instruction jsonb,expected_benefit text,finding_title text,finding_title_ar text,finding_language text,before_run_id uuid,
  retest_run_id uuid,retest_run_status text,retest_done int,retest_total int,retest_report_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN QUERY
  SELECT p.id,p.finding_id,p.status,p.title,p.title_ar,p.created_at,m.display_name,a.decided_at,a.decided_by_name_at_event,
   p.proposed_by IS NOT DISTINCT FROM nazir.current_member_id(),p.instruction IS NOT NULL,p.instruction,
   p.expected_benefit,f.title,f.title_ar,f.language,f.run_id,
   p.retest_run_id,r.status,
   (SELECT count(*)::int FROM nazir.conversations c WHERE c.run_id=r.id AND c.status IN ('passed','failed','inconclusive')),
   (SELECT count(*)::int FROM nazir.conversations c WHERE c.run_id=r.id),
   (SELECT rp.id FROM nazir.reports rp WHERE rp.run_id=r.id AND rp.workspace_id=p.workspace_id ORDER BY rp.created_at DESC,rp.id DESC LIMIT 1)
  FROM nazir.proposals p
  LEFT JOIN nazir.members m ON m.id=p.proposed_by AND m.workspace_id=p.workspace_id
  LEFT JOIN nazir.findings f ON f.id=p.finding_id AND f.workspace_id=p.workspace_id
  LEFT JOIN nazir.runs r ON r.id=p.retest_run_id AND r.workspace_id=p.workspace_id
  LEFT JOIN LATERAL (SELECT x.decided_at,x.decided_by_name_at_event FROM nazir.approvals x WHERE x.workspace_id=p.workspace_id AND x.subject_type='proposal' AND x.subject_id=p.id ORDER BY x.decided_at DESC,x.created_at DESC LIMIT 1) a ON true
  WHERE p.workspace_id=nazir.current_workspace_id() AND p.title_ar IS NOT NULL AND p.status<>'withdrawn' AND (p_id IS NULL OR p.id=p_id)
  ORDER BY p.created_at DESC,p.id LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION nazir.list_proposals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.list_proposals(uuid) TO nazir_app;

-- Metadata stays behind the same workspace guard, including for members who
-- cannot SELECT raw report rows. Bodies still use their existing role projection.
DROP FUNCTION nazir.list_reports();
CREATE FUNCTION nazir.list_reports(p_include uuid[] DEFAULT '{}'::uuid[], p_fix uuid DEFAULT NULL)
RETURNS TABLE(id uuid,created_at timestamptz,run_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF coalesce(cardinality(p_include),0)>3 THEN RAISE EXCEPTION 'Too many report links'; END IF;
 RETURN QUERY
  (SELECT r.id,r.created_at,r.run_id FROM nazir.reports r WHERE r.workspace_id=nazir.current_workspace_id() ORDER BY r.created_at DESC,r.id DESC LIMIT 20)
  UNION
  SELECT r.id,r.created_at,r.run_id FROM nazir.reports r
   WHERE r.workspace_id=nazir.current_workspace_id() AND
    (r.id=ANY(p_include) OR r.id IN
      (SELECT DISTINCT ON (rp.run_id) rp.id FROM nazir.reports rp
       WHERE rp.workspace_id=nazir.current_workspace_id() AND rp.run_id IN
        (SELECT unnest(ARRAY[f.run_id,p.retest_run_id]) FROM nazir.proposals p
         JOIN nazir.findings f ON f.id=p.finding_id AND f.workspace_id=p.workspace_id
         WHERE p.workspace_id=nazir.current_workspace_id() AND p.id=p_fix AND p.status<>'withdrawn')
       ORDER BY rp.run_id,rp.created_at DESC,rp.id DESC))
  ORDER BY 2 DESC,1 DESC;
END $$;
REVOKE ALL ON FUNCTION nazir.list_reports(uuid[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.list_reports(uuid[],uuid) TO nazir_app;
