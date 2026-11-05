-- Demo history v2. It now points at the real Government tests and the real planted fault versions of the demo workspace
-- (installed by src/server/demo/library.ts), so the waiting fix can be approved and checked again like any other.
-- It writes nothing until that library is there, and never touches a rule pack that a real Quick check would choose.
CREATE OR REPLACE FUNCTION nazir.demo_seed() RETURNS boolean
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
 IF EXISTS(SELECT 1 FROM nazir.reports WHERE workspace_id=w AND created_at>clock_timestamp()-interval '3 days') THEN RETURN false; END IF;
 SELECT id INTO v_wrong FROM nazir.agent_versions WHERE workspace_id=w AND config->>'registry_id'='planted_wrong_queue' ORDER BY created_at LIMIT 1;
 SELECT id INTO v_false FROM nazir.agent_versions WHERE workspace_id=w AND config->>'registry_id'='planted_false_submit' ORDER BY created_at LIMIT 1;
 SELECT id INTO pack_version FROM nazir.rule_pack_versions WHERE workspace_id=w AND status='approved' ORDER BY created_at DESC,id LIMIT 1;
 SELECT count(*) INTO found FROM nazir.scenarios WHERE workspace_id=w AND status='approved' AND split='development' AND stable_key IN
  ('english_msa_equivalent_normal_en','complaint_vs_suggestion_normal_en','success_without_case_normal_en','correct_reference_rules_trap_en',
   'success_without_case_normal_ar','another_requesters_case_trap_ar','open_case_described_resolved_trap_ar','unresolved_prior_request_trap_ar');
 IF v_wrong IS NULL OR v_false IS NULL OR pack_version IS NULL OR found<>8 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM nazir.members WHERE id IN (omar,yusuf,bilal) AND workspace_id=w HAVING count(*)=3) THEN RETURN false; END IF;

 INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,repeat_count,budget_calls,stop_rules,status,proposed_by_type,proposed_by,approved_by,approved_at,created_at)
  VALUES(w,'Quick check',v_wrong,pack_version,ARRAY['complaint'],ARRAY['en','ar'],1,1,48,'{"size":"quick"}','approved','member',omar,omar,t1,t1) RETURNING id INTO plan1;
 INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,repeat_count,budget_calls,stop_rules,status,proposed_by_type,proposed_by,approved_by,approved_at,created_at)
  VALUES(w,'Quick check',v_wrong,pack_version,ARRAY['complaint'],ARRAY['en','ar'],1,1,48,'{"size":"quick"}','approved','member',omar,omar,t2,t2) RETURNING id INTO plan2;
 INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,calls_used,calls_budget,idempotency_key,repeat_count,started_at,finished_at,created_at)
  VALUES(w,plan1,v_wrong,pack_version,'{"size":"quick","testCount":8}','n13','failed',16,48,'demo-seed-'||stamp||'-1',1,t1,t1+interval '4 minutes',t1) RETURNING id INTO run1;
 INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,calls_used,calls_budget,idempotency_key,repeat_count,started_at,finished_at,created_at)
  VALUES(w,plan2,v_wrong,pack_version,'{"size":"quick","testCount":8}','n13','failed',16,48,'demo-seed-'||stamp||'-2',1,t2,t2+interval '4 minutes',t2) RETURNING id INTO run2;

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
   -- First check fails tests 1, 2 and 3. After the approved routing fix, the second fails only 2 and 3.
   ok:=NOT ((i=1 AND s.n IN (1,2,3)) OR (i=2 AND s.n IN (2,3)));
   INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key,status,attempt,attempt_number,agent_version_id,started_at,finished_at,result_summary,created_at)
    SELECT w,run,sid,sc.language,'demo-'||s.n,CASE WHEN ok THEN 'passed' ELSE 'failed' END,1,1,v_wrong,at,at+interval '2 minutes','{}',at+(s.n||' seconds')::interval
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
      pack_version,'A complaint is submitted only when a case exists',v_false,'critical','adapter_failure','supplier_maintainer','{}',at+interval '3 minutes'
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
 UPDATE nazir.findings SET status='retest_passed' WHERE id=f_wrong;
 INSERT INTO nazir.proposals(workspace_id,finding_id,proposed_by_type,proposed_by,evidence,patch,expected_benefit,possible_regression,title,title_ar,root_cause_class,suggested_by_nazir,created_at)
  VALUES(w,f_false,'member',bilal,'The agent said the complaint was submitted, but no case was saved.','[{"op":"remove_create_case_fault"},{"op":"remove_false_submit_claim"}]',
   'A case is stored when the agent says submitted, and a failure is reported honestly.','A real tool failure must still be reported as a failure, never as success.',
   'Stop the false submission claim and the planted case failure','إيقاف ادعاء التقديم الكاذب وخلل إنشاء الحالة المزروع','adapter_failure',false,t2+interval '40 minutes') RETURNING id INTO prop_b;
 UPDATE nazir.findings SET status='repair_proposed' WHERE id=f_false;

 INSERT INTO nazir.audit_events(workspace_id,actor_type,action,target_type,target_id,payload)
  VALUES(w,'system','demo.history_seeded','workspace',w::text,jsonb_build_object('runs',2,'proposals',2));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION nazir.demo_seed() FROM PUBLIC;

-- Withdrawn fixes are not waiting fixes.
CREATE OR REPLACE FUNCTION nazir.list_proposals() RETURNS TABLE(id uuid,finding_id uuid,status text,title text,title_ar text,created_at timestamptz,proposed_by_name text,decided_at timestamptz,decided_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN QUERY
  SELECT p.id,p.finding_id,p.status,p.title,p.title_ar,p.created_at,m.display_name,a.decided_at,a.decided_by_name_at_event
  FROM nazir.proposals p
  LEFT JOIN nazir.members m ON m.id=p.proposed_by AND m.workspace_id=p.workspace_id
  LEFT JOIN LATERAL (SELECT x.decided_at,x.decided_by_name_at_event FROM nazir.approvals x WHERE x.workspace_id=p.workspace_id AND x.subject_type='proposal' AND x.subject_id=p.id ORDER BY x.decided_at DESC,x.created_at DESC LIMIT 1) a ON true
  WHERE p.workspace_id=nazir.current_workspace_id() AND p.title_ar IS NOT NULL AND p.status<>'withdrawn'
  ORDER BY p.created_at DESC,p.id LIMIT 100;
END $$;
