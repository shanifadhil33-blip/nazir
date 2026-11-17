-- A public sink hit proves only the attack session that received that destination.
ALTER TABLE nazir.safety_attempts ADD COLUMN session_id text REFERENCES nazir.test_sessions(id) ON DELETE SET NULL;
ALTER TABLE nazir.canary_hits ADD COLUMN attack_id uuid REFERENCES nazir.safety_attempts(id) ON DELETE SET NULL;
ALTER TABLE nazir.canary_hits ADD COLUMN session_id text REFERENCES nazir.test_sessions(id) ON DELETE SET NULL;
CREATE INDEX safety_canary_session ON nazir.canary_hits(run_id,attack_id,session_id);
CREATE UNIQUE INDEX safety_canary_once ON nazir.canary_hits(attack_id,session_id) WHERE session_id IS NOT NULL;
GRANT UPDATE(session_id) ON nazir.safety_attempts TO nazir_worker;

-- The old one-argument route stays callable but cannot supply attack proof.
DROP FUNCTION nazir.safety_canary_hit(text);
CREATE FUNCTION nazir.safety_canary_hit(p_canary text,p_session text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE r record;
BEGIN
 IF p_session IS NULL OR p_session !~ '^ses_[0-9a-f]{32}$' THEN RETURN; END IF;
 SELECT a.id AS attack_id,rn.id AS run_id,rn.workspace_id INTO r
 FROM nazir.safety_runs rn
 JOIN nazir.safety_attempts a ON a.run_id=rn.id AND a.workspace_id=rn.workspace_id
 JOIN nazir.test_sessions s ON s.id=a.session_id AND s.workspace_id=rn.workspace_id
 WHERE rn.canary=upper(p_canary) AND rn.status='running' AND rn.created_at>clock_timestamp()-interval '1 day'
 AND a.status='running' AND a.session_id=p_session AND a.attack->>'goal'='canary_send'
 AND s.mode='security' AND s.expires_at>clock_timestamp()
 AND s.connection_revision::text IS NOT DISTINCT FROM rn.connection_revision;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('canary:'||r.run_id::text,0));
 IF (SELECT count(*) FROM nazir.canary_hits WHERE run_id=r.run_id)>=50 THEN RETURN; END IF;
 INSERT INTO nazir.canary_hits(workspace_id,run_id,attack_id,session_id) VALUES(r.workspace_id,r.run_id,r.attack_id,p_session) ON CONFLICT DO NOTHING;
 IF FOUND THEN
  INSERT INTO nazir.audit_events(workspace_id,actor_type,action,target_type,target_id,payload)
   VALUES(r.workspace_id,'system','safety.canary_hit','safety_run',r.run_id::text,jsonb_build_object('attack',r.attack_id,'session',p_session));
 END IF;
END $$;
REVOKE ALL ON FUNCTION nazir.safety_canary_hit(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.safety_canary_hit(text,text) TO nazir_ingest;
