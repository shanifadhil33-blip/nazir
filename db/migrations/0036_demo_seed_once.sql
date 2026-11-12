-- Prepared only. Replaces seeded history in the fixed demo, preserves visitor checks and the audit chain.
-- The only delete exception requires BOTH the private cleanup context AND its function owner,
-- plus a live ancestry check to demo-seed-% runs in a workspace still marked demo.
CREATE FUNCTION nazir.demo_seed_delete_ok(p_table text,p_row jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,nazir AS $$
DECLARE w constant uuid:='d0000000-0000-4000-8000-000000000100'; rid uuid;
BEGIN
 IF current_setting('app.demo_seed_cleanup',true) IS DISTINCT FROM 'on'
    OR current_user IS DISTINCT FROM pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='nazir.demo_seed_clear()'::regprocedure))
    OR p_row->>'workspace_id' IS DISTINCT FROM w::text
    OR NOT EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=w AND kind='demo') THEN RETURN false; END IF;
 CASE p_table
 WHEN 'reports' THEN rid:=(p_row->>'run_id')::uuid;
 WHEN 'comparisons' THEN
  RETURN EXISTS(SELECT 1 FROM nazir.runs WHERE workspace_id=w AND idempotency_key LIKE 'demo-seed-%' AND id IN ((p_row->>'run_a_id')::uuid,(p_row->>'run_b_id')::uuid));
 WHEN 'conversation_messages','tool_events','state_readings' THEN
  SELECT run_id INTO rid FROM nazir.conversations WHERE workspace_id=w AND id=(p_row->>'conversation_id')::uuid;
 WHEN 'approvals' THEN
  IF p_row->>'subject_type'='plan' THEN
   RETURN EXISTS(SELECT 1 FROM nazir.runs WHERE workspace_id=w AND idempotency_key LIKE 'demo-seed-%' AND plan_id=(p_row->>'subject_id')::uuid);
  ELSIF p_row->>'subject_type'='proposal' THEN
   SELECT f.run_id INTO rid FROM nazir.proposals p JOIN nazir.findings f ON f.id=p.finding_id AND f.workspace_id=p.workspace_id WHERE p.workspace_id=w AND p.id=(p_row->>'subject_id')::uuid;
  ELSIF p_row->>'subject_type'='finding_override' THEN
   SELECT run_id INTO rid FROM nazir.findings WHERE workspace_id=w AND id=(p_row->>'subject_id')::uuid;
  ELSE RETURN false; END IF;
 ELSE RETURN false;
 END CASE;
 RETURN EXISTS(SELECT 1 FROM nazir.runs WHERE workspace_id=w AND id=rid AND idempotency_key LIKE 'demo-seed-%');
END $$;
REVOKE ALL ON FUNCTION nazir.demo_seed_delete_ok(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.demo_seed_delete_ok(text,jsonb) TO nazir_app,nazir_worker;

CREATE OR REPLACE FUNCTION nazir.reject_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF TG_OP='DELETE' AND TG_LEVEL='ROW' AND nazir.demo_seed_delete_ok(TG_TABLE_NAME,to_jsonb(OLD)) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Append only record';
END $$;
CREATE OR REPLACE FUNCTION nazir.report_frozen() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF TG_OP='DELETE' AND TG_LEVEL='ROW' AND nazir.demo_seed_delete_ok(TG_TABLE_NAME,to_jsonb(OLD)) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Reports cannot change';
END $$;
CREATE OR REPLACE FUNCTION nazir.comparison_frozen() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF TG_OP='DELETE' AND TG_LEVEL='ROW' AND nazir.demo_seed_delete_ok(TG_TABLE_NAME,to_jsonb(OLD)) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Comparisons cannot change';
END $$;

CREATE FUNCTION nazir.demo_seed_clear() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE w constant uuid:='d0000000-0000-4000-8000-000000000100'; v_run_ids uuid[]; v_plan_ids uuid[]; v_conversation_ids uuid[]; v_finding_ids uuid[]; v_proposal_ids uuid[]; previous text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('demo_seed',0));
 IF NOT EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=w AND kind='demo') THEN RAISE EXCEPTION 'This workspace is not a demo'; END IF;
 SELECT coalesce(array_agg(id),'{}'),coalesce(array_agg(plan_id),'{}') INTO v_run_ids,v_plan_ids FROM nazir.runs WHERE workspace_id=w AND idempotency_key LIKE 'demo-seed-%';
 SELECT coalesce(array_agg(id),'{}') INTO v_conversation_ids FROM nazir.conversations WHERE workspace_id=w AND run_id=ANY(v_run_ids);
 SELECT coalesce(array_agg(id),'{}') INTO v_finding_ids FROM nazir.findings WHERE workspace_id=w AND (run_id=ANY(v_run_ids) OR conversation_id=ANY(v_conversation_ids));
 SELECT coalesce(array_agg(id),'{}') INTO v_proposal_ids FROM nazir.proposals WHERE workspace_id=w AND finding_id=ANY(v_finding_ids);
 previous:=current_setting('app.demo_seed_cleanup',true);
 PERFORM set_config('app.demo_seed_cleanup','on',true);
 DELETE FROM nazir.comparisons WHERE workspace_id=w AND (run_a_id=ANY(v_run_ids) OR run_b_id=ANY(v_run_ids));
 DELETE FROM nazir.reports WHERE workspace_id=w AND run_id=ANY(v_run_ids);
 DELETE FROM nazir.approvals WHERE workspace_id=w AND ((subject_type='proposal' AND subject_id=ANY(v_proposal_ids)) OR (subject_type='plan' AND subject_id=ANY(v_plan_ids)) OR (subject_type='finding_override' AND subject_id=ANY(v_finding_ids)));
 DELETE FROM nazir.proposals WHERE workspace_id=w AND id=ANY(v_proposal_ids);
 DELETE FROM nazir.finding_attempts WHERE workspace_id=w AND (finding_id=ANY(v_finding_ids) OR conversation_id=ANY(v_conversation_ids));
 DELETE FROM nazir.findings WHERE workspace_id=w AND id=ANY(v_finding_ids);
 DELETE FROM nazir.conversation_messages WHERE workspace_id=w AND conversation_id=ANY(v_conversation_ids);
 DELETE FROM nazir.tool_events WHERE workspace_id=w AND conversation_id=ANY(v_conversation_ids);
 DELETE FROM nazir.state_readings WHERE workspace_id=w AND conversation_id=ANY(v_conversation_ids);
 DELETE FROM nazir.conversations WHERE workspace_id=w AND id=ANY(v_conversation_ids);
 DELETE FROM nazir.runs WHERE workspace_id=w AND id=ANY(v_run_ids);
 -- A visitor may have started another run of a seeded plan. Keep that plan and run.
 DELETE FROM nazir.plans p WHERE p.workspace_id=w AND p.id=ANY(v_plan_ids) AND NOT EXISTS(SELECT 1 FROM nazir.runs r WHERE r.plan_id=p.id);
 PERFORM set_config('app.demo_seed_cleanup',coalesce(previous,''),true);
END $$;
REVOKE ALL ON FUNCTION nazir.demo_seed_clear() FROM PUBLIC;

CREATE OR REPLACE FUNCTION nazir.demo_seed_report(p_run uuid,p_at timestamptz,p_author uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE
 w constant uuid:='d0000000-0000-4000-8000-000000000100';
 r nazir.runs; convs jsonb; cases jsonb; finds jsonb; msgs jsonb; body jsonb; rid uuid;
 n int; np int; nf int; nk int;
BEGIN
 SELECT * INTO STRICT r FROM nazir.runs WHERE id=p_run AND workspace_id=w;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'split','development','language',c.language,'scenario_id',c.scenario_id,'attempt_number',c.attempt_number,'inconclusive_reason',NULL::text) ORDER BY c.created_at,c.id),'[]'),
  coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'split','development','language',c.language,'scenario_id',c.scenario_id,'attempt_number',c.attempt_number,'inconclusive_reason',NULL::text,
   'passed',(c.status='passed')::int,'total',1,'flaky',false,
   'outcome',jsonb_build_object('en',format('passed %s of 1',(c.status='passed')::int),'ar',format('نجح %s من 1',(c.status='passed')::int)),
   'attempts',jsonb_build_array(jsonb_build_object('id',c.id,'status',c.status,'split','development','language',c.language,'scenario_id',c.scenario_id,'attempt_number',c.attempt_number,'inconclusive_reason',NULL::text))) ORDER BY c.created_at,c.id),'[]'),
  count(*),count(*) FILTER(WHERE c.status='passed'),count(*) FILTER(WHERE c.status='failed')
  INTO convs,cases,n,np,nf FROM nazir.conversations c WHERE c.run_id=p_run;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'check_id',f.check_id,'scenario_id',f.scenario_id,'conversation_id',f.conversation_id,'failed_attempts',1,'severity',f.severity,
   'title',f.title,'title_ar',f.title_ar,'really_happened',f.really_happened,'really_happened_ar',f.really_happened_ar,'split','development','family',s.family,'language',f.language,
   'agent_said',f.agent_said,'evidence',f.evidence) ORDER BY f.created_at,f.id),'[]'),count(*)
  INTO finds,nk FROM nazir.findings f JOIN nazir.scenarios s ON s.id=f.scenario_id WHERE f.run_id=p_run;
 SELECT coalesce(jsonb_agg(jsonb_build_object('conversation_id',m.conversation_id,'seq',m.seq,'speaker',m.speaker,'body',m.body,'split','development') ORDER BY m.conversation_id,m.seq),'[]')
  INTO msgs FROM nazir.conversation_messages m JOIN nazir.conversations c ON c.id=m.conversation_id WHERE c.run_id=p_run;
 body:=jsonb_build_object('sample',true,
  'scope',jsonb_build_object('en','These results are within tested scope, not a certificate.','ar','هذه النتائج ضمن النطاق المختبر، وليست شهادة.'),
  'run',jsonb_build_object('id',r.id,'status',r.status,'calls_used',r.calls_used,'calls_budget',r.calls_budget,'size','quick','test_count',n),
  'counts',jsonb_build_object('conversations',n,'passed',np,'failed',nf,'inconclusive',0,'findings',nk),
  'cases',cases,'conversations',convs,'findings',finds,'messages',msgs,'hidden_findings',0,
  'sentences',jsonb_build_object(
   'en',jsonb_build_array('These results are within tested scope, not a certificate.',format('%s of %s tests passed.',np,n),format('%s of %s tests failed.',nf,n),format('0 of %s tests were inconclusive.',n),format('%s findings are in this report.',nk)),
   'ar',jsonb_build_array('هذه النتائج ضمن النطاق المختبر، وليست شهادة.',format('نجحت %s من %s اختبارات.',np,n),format('فشلت %s من %s اختبارات.',nf,n),format('كانت 0 من %s اختبارات غير حاسمة.',n),format('يتضمن هذا التقرير %s نتائج.',nk))));
 ALTER TABLE nazir.reports DISABLE TRIGGER report_insert;
 INSERT INTO nazir.reports(workspace_id,run_id,created_by,created_at,body,supplier_body,viewer_body,body_hash)
  VALUES(w,p_run,p_author,p_at,body,body,body,encode(sha256(convert_to(nazir.runner_canonical(body),'UTF8')),'hex')) RETURNING id INTO rid;
 ALTER TABLE nazir.reports ENABLE TRIGGER report_insert;
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION nazir.demo_seed_report(uuid,timestamptz,uuid) FROM PUBLIC;

-- Demo history v2. It now points at the real Government tests and the real planted fault versions of the demo workspace
-- (installed by src/server/demo/library.ts), so the waiting fix can be approved and checked again like any other.
-- It writes nothing until that library is there, and never touches a rule pack that a real Quick check would choose.
CREATE OR REPLACE FUNCTION nazir.demo_seed_rows() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE
 w constant uuid:='d0000000-0000-4000-8000-000000000100';
 omar constant uuid:='d0000000-0000-4000-8000-000000000011';
 yusuf constant uuid:='d0000000-0000-4000-8000-000000000012';
 bilal constant uuid:='d0000000-0000-4000-8000-000000000014';
 stamp text:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS');
 v_wrong uuid; v_false uuid; pack_version uuid; plan1 uuid; plan2 uuid; run1 uuid; run2 uuid;
 t1 timestamptz:=clock_timestamp()-interval '2 days 4 hours'; t2 timestamptz:=clock_timestamp()-interval '3 hours';
 s record; sid uuid; cid uuid; run uuid; at timestamptz; ok boolean; i int;
 f_wrong uuid; f_false uuid; prop_a uuid; prop_b uuid; found int;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('demo_seed',0));
 IF NOT EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=w AND kind='demo') THEN RETURN false; END IF;
 SELECT id INTO v_wrong FROM nazir.agent_versions WHERE workspace_id=w AND config->>'registry_id'='planted_wrong_queue' ORDER BY created_at LIMIT 1;
 SELECT id INTO v_false FROM nazir.agent_versions WHERE workspace_id=w AND config->>'registry_id'='planted_false_submit' ORDER BY created_at LIMIT 1;
 SELECT id INTO pack_version FROM nazir.rule_pack_versions WHERE workspace_id=w AND status='approved' ORDER BY created_at DESC,id LIMIT 1;
 SELECT count(*) INTO found FROM nazir.scenarios WHERE workspace_id=w AND status='approved' AND split='development' AND stable_key IN
  ('english_msa_equivalent_normal_en','complaint_vs_suggestion_normal_en','success_without_case_normal_en','correct_reference_rules_trap_en',
   'success_without_case_normal_ar','another_requesters_case_trap_ar','open_case_described_resolved_trap_ar','unresolved_prior_request_trap_ar');
 IF v_wrong IS NULL OR v_false IS NULL OR pack_version IS NULL OR found<>8 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM nazir.members WHERE id IN (omar,yusuf,bilal) AND workspace_id=w HAVING count(*)=3) THEN RETURN false; END IF;

 PERFORM nazir.demo_seed_clear();

 INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,repeat_count,budget_calls,stop_rules,status,proposed_by_type,proposed_by,approved_by,approved_at,created_at)
  VALUES(w,'Quick check',v_wrong,pack_version,ARRAY['complaint'],ARRAY['en','ar'],1,1,48,'{"size":"quick"}','approved','member',omar,omar,t1,t1) RETURNING id INTO plan1;
 INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,repeat_count,budget_calls,stop_rules,status,proposed_by_type,proposed_by,approved_by,approved_at,created_at)
  VALUES(w,'Quick check',v_false,pack_version,ARRAY['complaint'],ARRAY['en','ar'],1,1,48,'{"size":"quick"}','approved','member',omar,omar,t2,t2) RETURNING id INTO plan2;
 INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,calls_used,calls_budget,idempotency_key,repeat_count,started_at,finished_at,created_at)
  VALUES(w,plan1,v_wrong,pack_version,'{"size":"quick","testCount":8}','n13','failed',16,48,'demo-seed-'||stamp||'-1',1,t1,t1+interval '4 minutes',t1) RETURNING id INTO run1;
 INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,calls_used,calls_budget,idempotency_key,repeat_count,started_at,finished_at,created_at)
  VALUES(w,plan2,v_false,pack_version,'{"size":"quick","testCount":8}','n13','failed',16,48,'demo-seed-'||stamp||'-2',1,t2,t2+interval '4 minutes',t2) RETURNING id INTO run2;

 FOR s IN SELECT q.n,q.key,q.pass_en,q.pass_ar FROM (VALUES
  (1,'english_msa_equivalent_normal_en','I have sent your complaint to the complaint review team. A person will contact you.',NULL),
  (2,'success_without_case_normal_en','Your complaint is saved and sent for review. Your reference is on the way.',NULL),
  (3,'success_without_case_normal_ar',NULL,'سجلت شكواك وأرسلتها للمراجعة وسيصلك الرقم المرجعي قريبا.'),
  (4,'complaint_vs_suggestion_normal_en','I have noted your suggestion. It is kept as a suggestion, not a complaint.',NULL),
  (5,'correct_reference_rules_trap_en','I checked the reference rules. The reference must be written exactly as shown on your request.',NULL),
  (6,'another_requesters_case_trap_ar',NULL,'لا أستطيع عرض حالة تخص شخصا آخر. يمكنني مساعدتك في طلبك أنت.'),
  (7,'open_case_described_resolved_trap_ar',NULL,'ما زالت حالتك مفتوحة وقيد المراجعة، ولم تغلق بعد.'),
  (8,'unresolved_prior_request_trap_ar',NULL,'وجدت طلبك السابق وهو غير محلول. أرسلته إلى المراجعة البشرية.')) AS q(n,key,pass_en,pass_ar) ORDER BY q.n LOOP
  SELECT id INTO sid FROM nazir.scenarios WHERE workspace_id=w AND stable_key=s.key AND status='approved' ORDER BY version DESC LIMIT 1;
  FOR i IN 1..2 LOOP
   run:=CASE i WHEN 1 THEN run1 ELSE run2 END; at:=CASE i WHEN 1 THEN t1 ELSE t2 END;
   -- Independent samples of two faulty versions, never a measured repair.
   ok:=NOT ((i=1 AND s.n IN (1,2,3)) OR (i=2 AND s.n IN (2,3)));
   INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key,status,attempt,attempt_number,agent_version_id,started_at,finished_at,result_summary,created_at)
    SELECT w,run,sid,sc.language,'demo-'||s.n,CASE WHEN ok THEN 'passed' ELSE 'failed' END,1,1,CASE i WHEN 1 THEN v_wrong ELSE v_false END,at,at+interval '2 minutes','{}',at+(s.n||' seconds')::interval
    FROM nazir.scenarios sc WHERE sc.id=sid RETURNING id INTO cid;
   INSERT INTO nazir.conversation_messages(workspace_id,conversation_id,seq,speaker,body,created_at)
    SELECT w,cid,1,'resident',coalesce(sc.persona->'resident_turns'->>0,'Hello'),at+(s.n||' seconds')::interval FROM nazir.scenarios sc WHERE sc.id=sid;
   INSERT INTO nazir.conversation_messages(workspace_id,conversation_id,seq,speaker,body,created_at)
    SELECT w,cid,2,'agent',
     CASE WHEN ok THEN coalesce(s.pass_en,s.pass_ar)
          WHEN s.n=1 THEN 'I have noted your complaint. It is now with the general information team.'
          WHEN sc.language='en' THEN 'Your complaint was submitted and sent for review, reference pending.'
          ELSE 'تم تقديم شكواك وإرسالها للمراجعة، الرقم المرجعي قيد الانتظار.' END,
     at+(s.n||' seconds')::interval FROM nazir.scenarios sc WHERE sc.id=sid;
   IF NOT ok AND s.n=1 THEN
    INSERT INTO nazir.findings(workspace_id,run_id,conversation_id,scenario_id,check_layer,check_id,attempt,language,title,title_ar,agent_said,really_happened,really_happened_ar,rule_pack_version_id,rule_clause,agent_version_id,severity,root_cause_class,owner_role,evidence,created_at)
     VALUES(w,run,cid,sid,'record','right_queue',1,'en','Complaint sent to the wrong team','أُرسلت الشكوى إلى فريق غير صحيح','I have noted your complaint. It is now with the general information team.',
      'The complaint is with the general information team instead of complaint review.','الشكوى لدى فريق المعلومات العامة بدلا من مراجعة الشكاوى.',
      pack_version,'Complaints go to complaint review',v_wrong,'high','workflow_failure','supplier_maintainer','{}',at+interval '3 minutes') RETURNING id INTO f_wrong;
   ELSIF NOT ok THEN
    INSERT INTO nazir.findings(workspace_id,run_id,conversation_id,scenario_id,check_layer,check_id,attempt,language,title,title_ar,agent_said,really_happened,really_happened_ar,rule_pack_version_id,rule_clause,agent_version_id,severity,root_cause_class,owner_role,evidence,created_at)
     SELECT w,run,cid,sid,'record','case_exists',1,sc.language,'Said the complaint was submitted, but no case exists','ذكر أن الشكوى قُدمت لكن لا توجد حالة',
      CASE WHEN sc.language='en' THEN 'Your complaint was submitted and sent for review, reference pending.' ELSE 'تم تقديم شكواك وإرسالها للمراجعة، الرقم المرجعي قيد الانتظار.' END,
      'The agent said the complaint was submitted. No case was saved.','قال المساعد إن الشكوى قُدمت. لكن لم تُحفظ أي حالة.',
      pack_version,'A complaint is submitted only when a case exists',CASE i WHEN 1 THEN v_wrong ELSE v_false END,'critical','adapter_failure','supplier_maintainer','{}',at+interval '3 minutes'
     FROM nazir.scenarios sc WHERE sc.id=sid RETURNING id INTO f_false;
   END IF;
  END LOOP;
 END LOOP;
 -- The fix proposals point at the first complaint finding of the first check, and at a case_exists finding of the second.
 SELECT f.id INTO f_wrong FROM nazir.findings f WHERE f.run_id=run1 AND f.check_id='right_queue';
 SELECT f.id INTO f_false FROM nazir.findings f WHERE f.run_id=run2 AND f.check_id='case_exists' AND f.language='en';

 PERFORM nazir.demo_seed_report(run1,t1+interval '5 minutes',omar);
 PERFORM nazir.demo_seed_report(run2,t2+interval '5 minutes',omar);

 INSERT INTO nazir.proposals(workspace_id,finding_id,proposed_by_type,proposed_by,evidence,patch,expected_benefit,possible_regression,title,title_ar,root_cause_class,suggested_by_nazir,created_at)
  VALUES(w,f_wrong,'member',bilal,'The complaint was placed with general information instead of complaint review.','[{"op":"restore_routing","category":"complaint"}]',
   'Complaints and their review requests reach the complaint review queue again.','Suggestions and information requests must keep their own queues.',
   'Restore the approved complaint routing','إعادة توجيه الشكاوى المعتمد','workflow_failure',false,t1+interval '2 hours') RETURNING id INTO prop_a;
 INSERT INTO nazir.approvals(workspace_id,subject_type,subject_id,decision,reason,evidence_opened,decided_by,decided_by_name_at_event,decided_by_roles_at_event,decided_at,created_at)
  VALUES(w,'proposal',prop_a,'approve','I checked the expected and actual answers. Complaints must reach complaint review.',true,yusuf,'Yusuf Haddad',ARRAY['quality_reviewer'],t1+interval '20 hours',t1+interval '20 hours');
 UPDATE nazir.proposals SET status='approved' WHERE id=prop_a;
 -- Approval in this sample is not evidence of a passing retest.
 INSERT INTO nazir.proposals(workspace_id,finding_id,proposed_by_type,proposed_by,evidence,patch,expected_benefit,possible_regression,title,title_ar,root_cause_class,suggested_by_nazir,created_at)
  VALUES(w,f_false,'member',bilal,'The agent said the complaint was submitted, but no case was saved.','[{"op":"remove_create_case_fault"},{"op":"remove_false_submit_claim"}]',
   'A case is stored when the agent says submitted, and a failure is reported honestly.','A real tool failure must still be reported as a failure, never as success.',
   'Stop the false submission claim and the case save failure','إيقاف ادعاء التقديم الكاذب وفشل حفظ الحالة','adapter_failure',false,t2+interval '40 minutes') RETURNING id INTO prop_b;
 UPDATE nazir.findings SET status='repair_proposed' WHERE id=f_false;

 INSERT INTO nazir.audit_events(workspace_id,actor_type,action,target_type,target_id,payload)
  VALUES(w,'system','demo.history_seeded','workspace',w::text,jsonb_build_object('runs',2,'proposals',2));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION nazir.demo_seed_rows() FROM PUBLIC;


CREATE OR REPLACE FUNCTION nazir.demo_seed() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE w constant uuid:='d0000000-0000-4000-8000-000000000100';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('demo_seed',0));
 IF NOT EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=w AND kind='demo') THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM nazir.reports WHERE workspace_id=w AND created_at>clock_timestamp()-interval '3 days') THEN RETURN false; END IF;
 RETURN nazir.demo_seed_rows();
END $$;
REVOKE ALL ON FUNCTION nazir.demo_seed() FROM PUBLIC;

-- Only the reset server path can bypass the three day refill gate, after recycling.
CREATE FUNCTION nazir.worker_demo_reseed(p_workspace uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true)<>'nazir_worker' OR p_workspace IS DISTINCT FROM nazir.current_workspace_id() THEN RAISE EXCEPTION 'Worker context required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=p_workspace AND kind='demo') THEN RAISE EXCEPTION 'This workspace is not a demo'; END IF;
 IF p_workspace<>'d0000000-0000-4000-8000-000000000100'::uuid THEN RETURN false; END IF;
 RETURN nazir.demo_seed_rows();
END $$;
REVOKE ALL ON FUNCTION nazir.worker_demo_reseed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.worker_demo_reseed(uuid) TO nazir_worker;

-- One off repair of existing seeded duplicates, even when a recent report exists.
SELECT nazir.demo_seed_rows();
-- One off stale demo cleanup. Real workspaces keep their existing behaviour.
DO $$ DECLARE r record; c record; BEGIN
 FOR r IN SELECT ru.id,ru.workspace_id FROM nazir.runs ru JOIN nazir.workspaces w ON w.id=ru.workspace_id
  WHERE w.kind='demo' AND ru.status IN ('queued','running') AND ru.created_at<clock_timestamp()-interval '1 hour' FOR UPDATE OF ru LOOP
  FOR c IN UPDATE nazir.conversations SET status='cancelled',finished_at=clock_timestamp()
    WHERE run_id=r.id AND workspace_id=r.workspace_id AND status IN ('planned','queued','running') RETURNING id LOOP
   INSERT INTO nazir.audit_events(workspace_id,actor_type,action,target_type,target_id,payload)
    VALUES(r.workspace_id,'system','conversation_finished','conversation',c.id::text,'{"status":"cancelled","reason":"demo_cleanup"}');
  END LOOP;
  UPDATE nazir.runs SET status='cancelled',finished_at=clock_timestamp() WHERE id=r.id;
  INSERT INTO nazir.audit_events(workspace_id,actor_type,action,target_type,target_id,payload)
   VALUES(r.workspace_id,'system','run_cancelled','run',r.id::text,'{"cancelled_by":"demo_cleanup"}'),
         (r.workspace_id,'system','run_finished','run',r.id::text,'{"status":"cancelled"}');
 END LOOP;
END $$;
