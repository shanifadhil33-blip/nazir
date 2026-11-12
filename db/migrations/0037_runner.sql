-- Discovery only. No evidence, bodies, messages or secrets cross the worker boundary.
-- Existing runner_claim signatures, member checks and workspace RLS remain unchanged.
CREATE FUNCTION nazir.runner_pending(p_limit integer DEFAULT 100)
RETURNS TABLE(run_id uuid,workspace_id uuid,started_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'nazir_worker' THEN RAISE EXCEPTION 'Worker required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
 RETURN QUERY
 SELECT r.id,r.workspace_id,m.id
 FROM nazir.runs r
 JOIN LATERAL (
   SELECT a.payload->>'started_by' AS starter FROM nazir.audit_events a
   WHERE a.workspace_id=r.workspace_id AND a.target_type='run' AND a.target_id=r.id::text AND a.action='run_enqueued'
   ORDER BY a.seq LIMIT 1
 ) a ON true
 JOIN nazir.members m ON m.id::text=a.starter AND m.workspace_id=r.workspace_id AND m.status='active'
 WHERE r.status IN ('queued','running') OR
   (r.status IN ('passed','failed','inconclusive','cancelled') AND NOT EXISTS(SELECT FROM nazir.reports p WHERE p.run_id=r.id AND p.workspace_id=r.workspace_id AND p.body->'run'->>'status' IN ('passed','failed','inconclusive','cancelled')))
 ORDER BY r.created_at,r.id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION nazir.runner_pending(integer) FROM PUBLIC,nazir_app,nazir_auth;
GRANT EXECUTE ON FUNCTION nazir.runner_pending(integer) TO nazir_worker;
