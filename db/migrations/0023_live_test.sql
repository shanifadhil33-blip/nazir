-- N23 live judge test.
-- A claim scoped to one run, so an in request worker only ever runs the conversations it queued.
CREATE FUNCTION nazir.runner_claim(p_worker text,p_lease_seconds int,p_run uuid)
RETURNS TABLE(workspace_id uuid,conversation_id uuid,run_id uuid,attempt int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE c nazir.conversations; previous_context text; recovered boolean; a int;
BEGIN
 IF current_setting('role',true)<>'nazir_worker' OR p_worker IS NULL OR p_worker !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900 OR p_run IS NULL THEN RAISE EXCEPTION 'Invalid claim'; END IF;
 previous_context:=current_setting('app.workspace_id',true);
 LOOP
  SELECT q.* INTO c FROM nazir.conversations q JOIN nazir.runs r ON r.id=q.run_id
  WHERE r.id=p_run AND r.status IN ('queued','running') AND ((q.status='queued' AND q.available_at<=clock_timestamp()) OR (q.status='running' AND q.lease_expires_at<=clock_timestamp()))
  ORDER BY q.created_at,q.id FOR UPDATE OF r,q SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN EXIT; END IF;
  PERFORM set_config('app.workspace_id',c.workspace_id::text,true);
  recovered:=c.status='running';
  IF recovered AND c.attempt>=c.max_attempts THEN
   UPDATE nazir.conversations SET status='inconclusive',inconclusive_reason='lease_expired',last_error='lease_expired',finished_at=clock_timestamp(),result_summary='{}',lease_owner=NULL,lease_expires_at=NULL WHERE id=c.id;
   PERFORM nazir.append_audit('conversation_finished','conversation',c.id::text,jsonb_build_object('status','inconclusive','reason','lease_expired','attempt',c.attempt,'provider',c.model_provider,'model',c.model_id,'failover',c.failover));
   PERFORM nazir.runner_aggregate(c.run_id);
   CONTINUE;
  END IF;
  a:=c.attempt+CASE WHEN c.sandbox_tenant IS NOT NULL THEN 1 ELSE 0 END;
  UPDATE nazir.conversations SET status='running',attempt=a,lease_owner=p_worker,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),heartbeat_at=clock_timestamp(),sandbox_tenant='r_'||replace(c.id::text,'-','')||'_'||a,started_at=coalesce(started_at,clock_timestamp()) WHERE id=c.id;
  UPDATE nazir.runs SET status='running',started_at=coalesce(started_at,clock_timestamp()) WHERE id=c.run_id AND status='queued';
  IF FOUND THEN PERFORM nazir.append_audit('run_started','run',c.run_id::text,'{}'); END IF;
  IF recovered THEN PERFORM nazir.append_audit('lease_recovered','conversation',c.id::text,jsonb_build_object('attempt',a)); END IF;
  PERFORM nazir.append_audit('conversation_claimed','conversation',c.id::text,jsonb_build_object('run_id',c.run_id,'attempt',a));
  workspace_id:=c.workspace_id; conversation_id:=c.id; run_id:=c.run_id; attempt:=a;
  PERFORM set_config('app.workspace_id',coalesce(previous_context,''),true);
  RETURN NEXT; RETURN;
 END LOOP;
 PERFORM set_config('app.workspace_id',coalesce(previous_context,''),true);
END $$;
REVOKE ALL ON FUNCTION nazir.runner_claim(text,int,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.runner_claim(text,int,uuid) TO nazir_worker;

-- Called by the server after it checked the member in the app role; the worker role skips the member write trigger, so the copy keeps
-- the approval of the prepared case instead of claiming a new one.
-- The judge's own complaint becomes the first resident turn of a copy of the prepared complaint trap case.
-- Expected records, checks and the follow up turn stay those of the approved case, so the checks keep their meaning.
-- Demo workspaces only; the copy is labelled typed_by judge, keeps the approval of the prepared case it copies, and never enters the library.
CREATE FUNCTION nazir.live_test_scenario(p_member uuid,p_lang text,p_text text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE w uuid; m uuid; base nazir.scenarios; t text; follow text; turns jsonb; k text; sid uuid;
BEGIN
 IF current_setting('role',true)<>'nazir_worker' THEN RAISE EXCEPTION 'Worker required'; END IF;
 w:=nullif(current_setting('app.workspace_id',true),'')::uuid;
 SELECT id INTO m FROM nazir.members WHERE id=p_member AND workspace_id=w AND status='active';
 IF w IS NULL OR m IS NULL THEN RAISE EXCEPTION 'Member required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=w AND kind='demo') THEN RAISE EXCEPTION 'Live test runs in demo workspaces only'; END IF;
 IF p_lang IS NULL OR p_lang NOT IN ('en','ar') THEN RAISE EXCEPTION 'Invalid language'; END IF;
 t:=btrim(regexp_replace(coalesce(p_text,''),'[[:cntrl:]]+',' ','g'));
 IF char_length(t) NOT BETWEEN 8 AND 400 THEN RAISE EXCEPTION 'Complaint length'; END IF;
 SELECT s.* INTO base FROM nazir.scenarios s WHERE s.workspace_id=w AND s.stable_key='complaint_vs_suggestion_trap_'||p_lang AND s.status='approved' ORDER BY s.version DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prepared case missing'; END IF;
 follow:=CASE p_lang WHEN 'ar' THEN 'أنا سعيد الهاشمي، رقم الطلب SR-1042. أؤكد الشكوى وأطلب مراجعة بشرية.' ELSE 'Saeed Al Hashimi, SR-1042. I confirm my complaint and want human review.' END;
 turns:=jsonb_build_array(t,follow);
 k:='live_judge_'||p_lang||'_'||substr(encode(sha256(convert_to(t||clock_timestamp()::text||gen_random_uuid()::text,'UTF8')),'hex'),1,16);
 INSERT INTO nazir.scenarios(workspace_id,meaning_id,stable_key,version,family,language,split,persona,starting_state,allowed_actions,forbidden_actions,expected_state,source_clause,expectation_kind,severity,rubric_version,status,approved_by,approved_at,resident_turns,checks,source,library_hash,created_by)
 VALUES(w,base.meaning_id,k,1,base.family,p_lang,'development',base.persona||jsonb_build_object('resident_turns',turns,'typed_by','judge'),base.starting_state,base.allowed_actions,base.forbidden_actions,base.expected_state,base.source_clause,base.expectation_kind,base.severity,base.rubric_version,'approved',base.approved_by,clock_timestamp(),turns,base.checks,'authored',NULL,m)
 RETURNING id INTO sid;
 PERFORM nazir.append_audit('live_test_case','scenario',sid::text,jsonb_build_object('base',base.id,'language',p_lang,'typed_by',m));
 RETURN sid;
END $$;
REVOKE ALL ON FUNCTION nazir.live_test_scenario(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.live_test_scenario(uuid,text,text) TO nazir_worker;

-- Once its runs are queued the copy is retired, so no planner, suite or library pick ever sees a judge typed case.
-- The worker loads a queued conversation's case by id and checks its content hash, which ignores status.
CREATE FUNCTION nazir.live_test_retire(p_scenario uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true)<>'nazir_worker' THEN RAISE EXCEPTION 'Worker required'; END IF;
 UPDATE nazir.scenarios SET status='retired' WHERE id=p_scenario AND workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid AND stable_key LIKE 'live_judge_%' AND persona ? 'typed_by' AND status='approved';
END $$;
REVOKE ALL ON FUNCTION nazir.live_test_retire(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.live_test_retire(uuid) TO nazir_worker;
