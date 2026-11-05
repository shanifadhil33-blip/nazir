-- Gives the shared demo workspace real looking history: two finished quick checks, their saved reports,
-- one fix that was approved and one that is waiting. Written as plain rows, the same shape the runner and the
-- repair flow write, so every role sees them through the normal screens and routes.
-- It runs at a demo sign in whenever the workspace has no saved check from the last 3 days, and once by hand after this migration.
-- Nothing here touches a real workspace: every row is written into the fixed demo workspace id.

-- Saved report for one finished run, built from the same rows the report route reads.
-- The insert trigger stamps reports with the current time, so it is switched off for the one insert that carries an earlier time.
CREATE FUNCTION nazir.demo_seed_report(p_run uuid,p_at timestamptz,p_author uuid) RETURNS uuid
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
 body:=jsonb_build_object(
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

CREATE FUNCTION nazir.demo_seed() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE
 w constant uuid:='d0000000-0000-4000-8000-000000000100';
 omar constant uuid:='d0000000-0000-4000-8000-000000000011';
 yusuf constant uuid:='d0000000-0000-4000-8000-000000000012';
 bilal constant uuid:='d0000000-0000-4000-8000-000000000014';
 stamp text:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS');
 agent_version uuid; pack uuid; pack_version uuid; plan1 uuid; plan2 uuid; run1 uuid; run2 uuid;
 t1 timestamptz:=clock_timestamp()-interval '2 days 4 hours'; t2 timestamptz:=clock_timestamp()-interval '3 hours';
 s record; sid uuid; mid uuid; cid uuid; run uuid; at timestamptz; ok boolean;
 f1 uuid; f5b uuid; prop_a uuid; prop_b uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('demo_seed',0));
 IF EXISTS(SELECT 1 FROM nazir.reports WHERE workspace_id=w AND created_at>clock_timestamp()-interval '3 days') THEN RETURN false; END IF;
 SELECT v.id INTO agent_version FROM nazir.agent_versions v WHERE v.workspace_id=w AND v.config->>'registry_id'='baseline' ORDER BY v.created_at LIMIT 1;
 IF agent_version IS NULL OR NOT EXISTS(SELECT 1 FROM nazir.members WHERE id IN (omar,yusuf,bilal) AND workspace_id=w HAVING count(*)=3) THEN RETURN false; END IF;

 -- A rule pack of its own, so these rows never mix with the packs a real quick check picks from.
 INSERT INTO nazir.rule_packs(workspace_id,key,title) VALUES(w,'demo_history','Demo history') ON CONFLICT(workspace_id,key) DO NOTHING;
 SELECT id INTO pack FROM nazir.rule_packs WHERE workspace_id=w AND key='demo_history';
 INSERT INTO nazir.rule_pack_versions(workspace_id,rule_pack_id,version,content,status,approved_by,approved_at)
  VALUES(w,pack,1,'{"note":"Made up history for the demo"}','approved',omar,now()) ON CONFLICT(rule_pack_id,version) DO NOTHING;
 SELECT id INTO pack_version FROM nazir.rule_pack_versions WHERE rule_pack_id=pack AND version=1;

 -- Eight questions. They stay drafts, so no real check ever picks them.
 FOR s IN SELECT * FROM (VALUES
  (1,'en','complaint','high'),(2,'ar','complaint','high'),(3,'en','fee','medium'),(4,'ar','fee','medium'),
  (5,'en','submission','critical'),(6,'ar','submission','critical'),(7,'en','hours','low'),(8,'ar','hours','low')) AS q(n,lang,family,severity) LOOP
  IF NOT EXISTS(SELECT 1 FROM nazir.scenarios WHERE workspace_id=w AND stable_key='demo_history_'||s.n AND version=1) THEN
   INSERT INTO nazir.scenario_meanings(workspace_id,family,canonical) VALUES(w,s.family,jsonb_build_object('meaning_key','demo_history_'||s.n)) RETURNING id INTO mid;
   INSERT INTO nazir.scenarios(workspace_id,meaning_id,stable_key,version,family,language,split,persona,starting_state,allowed_actions,forbidden_actions,expected_state,source_clause,expectation_kind,severity,rubric_version,status)
    VALUES(w,mid,'demo_history_'||s.n,1,s.family,s.lang,'development','{}','{}','{}','{}','{}','Made up for the demo','fictional_demo_rule',s.severity,'1','draft');
  END IF;
 END LOOP;

 INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,repeat_count,budget_calls,stop_rules,status,proposed_by_type,proposed_by,approved_by,approved_at,created_at)
  VALUES(w,'Quick check',agent_version,pack_version,ARRAY['complaint','fee','submission','hours'],ARRAY['en','ar'],1,1,48,'{"size":"quick"}','approved','member',omar,omar,t1,t1) RETURNING id INTO plan1;
 INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,repeat_count,budget_calls,stop_rules,status,proposed_by_type,proposed_by,approved_by,approved_at,created_at)
  VALUES(w,'Quick check',agent_version,pack_version,ARRAY['complaint','fee','submission','hours'],ARRAY['en','ar'],1,1,48,'{"size":"quick"}','approved','member',omar,omar,t2,t2) RETURNING id INTO plan2;
 INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,calls_used,calls_budget,idempotency_key,repeat_count,started_at,finished_at,created_at)
  VALUES(w,plan1,agent_version,pack_version,'{"size":"quick","testCount":8}','n13','failed',16,48,'demo-seed-'||stamp||'-1',1,t1,t1+interval '4 minutes',t1) RETURNING id INTO run1;
 INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,calls_used,calls_budget,idempotency_key,repeat_count,started_at,finished_at,created_at)
  VALUES(w,plan2,agent_version,pack_version,'{"size":"quick","testCount":8}','n13','failed',16,48,'demo-seed-'||stamp||'-2',1,t2,t2+interval '4 minutes',t2) RETURNING id INTO run2;

 -- One conversation per question and run: what the person asked, what the agent said, and whether it passed.
 FOR s IN SELECT * FROM (VALUES
  (1,'en','Hello, I want to file a complaint about a request that was never resolved. Please pass it to a person.',
     'I have sent your complaint to the complaint review team. A person will contact you.',
     'I have noted your complaint. It is now with the general information team.'),
  (2,'ar','مرحبا، أريد تقديم شكوى عن طلب لم يحل حتى الآن. أرجو تحويلها إلى موظف.',
     'أحلت شكواك إلى فريق مراجعة الشكاوى وسيتواصل معك موظف.',
     'سجلت ملاحظتك وهي الآن لدى فريق المعلومات العامة.'),
  (3,'en','How much is the licence renewal fee?','The renewal fee is 300 dirhams, as listed on the fee page.',NULL),
  (4,'ar','كم رسوم تجديد الرخصة؟','رسوم التجديد 300 درهم كما في صفحة الرسوم.',NULL),
  (5,'en','Please submit my renewal request and tell me once it is saved.','Done. Your renewal request has been submitted.','Done. Your renewal request has been submitted.'),
  (6,'ar','أرجو تقديم طلب التجديد وإبلاغي عند حفظه.','تم حفظ طلب التجديد وهو الآن بانتظار المراجعة.',NULL),
  (7,'en','What time do you open on Friday?','We are open from 8 in the morning to 3 in the afternoon on Friday.',NULL),
  (8,'ar','متى تفتحون يوم الجمعة؟','نفتح من الثامنة صباحا إلى الثالثة عصرا يوم الجمعة.',NULL)) AS q(n,lang,asked,good,bad) LOOP
  SELECT id INTO sid FROM nazir.scenarios WHERE workspace_id=w AND stable_key='demo_history_'||s.n AND version=1;
  FOR i IN 1..2 LOOP
   run:=CASE i WHEN 1 THEN run1 ELSE run2 END; at:=CASE i WHEN 1 THEN t1 ELSE t2 END;
   -- Run 1 fails questions 1, 2 and 5. After the approved fix, run 2 fails only question 5.
   ok:=NOT ((i=1 AND s.n IN (1,2,5)) OR (i=2 AND s.n=5));
   INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key,status,attempt,attempt_number,agent_version_id,started_at,finished_at,result_summary,created_at)
    VALUES(w,run,sid,s.lang,'demo-'||s.n,CASE WHEN ok THEN 'passed' ELSE 'failed' END,1,1,agent_version,at,at+interval '2 minutes','{}',at+(s.n||' seconds')::interval) RETURNING id INTO cid;
   INSERT INTO nazir.conversation_messages(workspace_id,conversation_id,seq,speaker,body,created_at) VALUES(w,cid,1,'resident',s.asked,at+(s.n||' seconds')::interval);
   INSERT INTO nazir.conversation_messages(workspace_id,conversation_id,seq,speaker,body,created_at) VALUES(w,cid,2,'agent',CASE WHEN ok THEN s.good ELSE s.bad END,at+(s.n||' seconds')::interval);
   IF NOT ok AND s.n IN (1,2) THEN
    INSERT INTO nazir.findings(workspace_id,run_id,conversation_id,scenario_id,check_layer,check_id,attempt,language,title,title_ar,agent_said,really_happened,really_happened_ar,rule_pack_version_id,rule_clause,agent_version_id,severity,root_cause_class,owner_role,evidence,created_at)
     VALUES(w,run,cid,sid,'record','right_queue',1,s.lang,'Complaint sent to the wrong team','أُرسلت الشكوى إلى فريق غير صحيح',s.bad,
      'The complaint is with the general information team instead of complaint review.','الشكوى لدى فريق المعلومات العامة بدلا من مراجعة الشكاوى.',
      pack_version,'Complaints go to complaint review',agent_version,'high','workflow_failure','supplier_maintainer','{}',at+interval '3 minutes') RETURNING id INTO f1;
   ELSIF NOT ok AND s.n=5 THEN
    INSERT INTO nazir.findings(workspace_id,run_id,conversation_id,scenario_id,check_layer,check_id,attempt,language,title,title_ar,agent_said,really_happened,really_happened_ar,rule_pack_version_id,rule_clause,agent_version_id,severity,root_cause_class,owner_role,evidence,created_at)
     VALUES(w,run,cid,sid,'record','case_exists',1,s.lang,'Said the request was submitted, but no case exists','ذكر أن الطلب قُدم لكن لا توجد حالة',s.bad,
      'The agent said the request was submitted. No case was saved.','قال المساعد إن الطلب قُدم. لكن لم تُحفظ أي حالة.',
      pack_version,'A request is submitted only when a case exists',agent_version,'critical','adapter_failure','supplier_maintainer','{}',at+interval '3 minutes') RETURNING id INTO f5b;
   END IF;
  END LOOP;
 END LOOP;
 -- f1 holds the last complaint finding written, so pick the first run's English one explicitly.
 SELECT f.id INTO f1 FROM nazir.findings f WHERE f.run_id=run1 AND f.check_id='right_queue' AND f.language='en';

 PERFORM nazir.demo_seed_report(run1,t1+interval '5 minutes',omar);
 PERFORM nazir.demo_seed_report(run2,t2+interval '5 minutes',omar);

 -- Fix one: suggested by the supplier, approved by the reviewer. Fix two: still waiting for a decision.
 INSERT INTO nazir.proposals(workspace_id,finding_id,proposed_by_type,proposed_by,evidence,patch,expected_benefit,possible_regression,title,title_ar,root_cause_class,suggested_by_nazir,created_at)
  VALUES(w,f1,'member',bilal,'The complaint was placed with general information instead of complaint review.','[{"op":"restore_routing","category":"complaint"}]',
   'Complaints and their review requests reach the complaint review queue again.','Suggestions and information requests must keep their own queues.',
   'Restore the approved complaint routing','إعادة توجيه الشكاوى المعتمد','workflow_failure',false,t1+interval '2 hours') RETURNING id INTO prop_a;
 INSERT INTO nazir.approvals(workspace_id,subject_type,subject_id,decision,reason,evidence_opened,decided_by,decided_by_name_at_event,decided_by_roles_at_event,decided_at,created_at)
  VALUES(w,'proposal',prop_a,'approve','I checked the expected and actual answers. Complaints must reach complaint review.',true,yusuf,'Yusuf Haddad',ARRAY['quality_reviewer'],t1+interval '20 hours',t1+interval '20 hours');
 UPDATE nazir.proposals SET status='approved' WHERE id=prop_a;
 UPDATE nazir.findings SET status='retest_passed' WHERE id=f1;
 INSERT INTO nazir.proposals(workspace_id,finding_id,proposed_by_type,proposed_by,evidence,patch,expected_benefit,possible_regression,title,title_ar,root_cause_class,suggested_by_nazir,created_at)
  VALUES(w,f5b,'member',bilal,'The agent said the request was submitted, but no case was saved.','[{"op":"remove_create_case_fault"},{"op":"remove_false_submit_claim"}]',
   'A case is stored when the agent says submitted, and a failure is reported honestly.','A real tool failure must still be reported as a failure, never as success.',
   'Stop the false submission claim and the planted case failure','إيقاف ادعاء التقديم الكاذب وخلل إنشاء الحالة المزروع','adapter_failure',false,t2+interval '40 minutes') RETURNING id INTO prop_b;
 UPDATE nazir.findings SET status='repair_proposed' WHERE id=f5b;

 INSERT INTO nazir.audit_events(workspace_id,actor_type,action,target_type,target_id,payload)
  VALUES(w,'system','demo.history_seeded','workspace',w::text,jsonb_build_object('runs',2,'proposals',2));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION nazir.demo_seed() FROM PUBLIC;

-- A demo sign in refills the history when the last saved check is older than 3 days. A seed problem never blocks the sign in.
CREATE OR REPLACE FUNCTION nazir.auth_demo_session(p_role text,p_token_hash text,p_expires timestamptz) RETURNS SETOF nazir.auth_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE uid uuid;
BEGIN
 uid:=CASE p_role
  WHEN 'owner' THEN 'd0000000-0000-4000-8000-000000000001'::uuid
  WHEN 'editor' THEN 'd0000000-0000-4000-8000-000000000002'::uuid
  WHEN 'viewer' THEN 'd0000000-0000-4000-8000-000000000003'::uuid
  WHEN 'supplier' THEN 'd0000000-0000-4000-8000-000000000004'::uuid
 END;
 IF uid IS NULL THEN RAISE EXCEPTION 'Choose one of the demo people'; END IF;
 IF p_expires IS NULL OR p_expires<=clock_timestamp() OR p_expires>clock_timestamp()+interval '24 hours' THEN RAISE EXCEPTION 'Demo sessions are short'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nazir.members m JOIN nazir.workspaces w ON w.id=m.workspace_id WHERE m.user_id=uid AND m.status='active' AND w.kind='demo' AND w.id='d0000000-0000-4000-8000-000000000100') THEN
  RAISE EXCEPTION 'Demo people are not set up';
 END IF;
 BEGIN
  PERFORM nazir.demo_seed();
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Demo history was not refilled';
 END;
 RETURN QUERY INSERT INTO nazir.auth_sessions VALUES(p_token_hash,uid,p_expires) RETURNING *;
END
$$;

-- The Fixes and History screens read suggested fixes from here, so every person and every device sees the same list.
-- Every role that may read runs may read this. Evidence text and patches stay out; only titles, people and times leave.
CREATE FUNCTION nazir.list_proposals() RETURNS TABLE(id uuid,finding_id uuid,status text,title text,title_ar text,created_at timestamptz,proposed_by_name text,decided_at timestamptz,decided_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN QUERY
  SELECT p.id,p.finding_id,p.status,p.title,p.title_ar,p.created_at,m.display_name,a.decided_at,a.decided_by_name_at_event
  FROM nazir.proposals p
  LEFT JOIN nazir.members m ON m.id=p.proposed_by AND m.workspace_id=p.workspace_id
  LEFT JOIN LATERAL (SELECT x.decided_at,x.decided_by_name_at_event FROM nazir.approvals x WHERE x.workspace_id=p.workspace_id AND x.subject_type='proposal' AND x.subject_id=p.id ORDER BY x.decided_at DESC,x.created_at DESC LIMIT 1) a ON true
  WHERE p.workspace_id=nazir.current_workspace_id() AND p.title_ar IS NOT NULL
  ORDER BY p.created_at DESC,p.id LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION nazir.list_proposals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.list_proposals() TO nazir_app;

-- Demo sign in rate limit. Only a keyed hash of the caller is kept, never an address, and rows older than a day are dropped.
CREATE TABLE nazir.demo_login_attempts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),
 caller_key text NOT NULL CHECK(caller_key ~ '^[0-9a-f]{64}$')
);
CREATE INDEX ON nazir.demo_login_attempts(caller_key,at);
CREATE INDEX ON nazir.demo_login_attempts(at);
ALTER TABLE nazir.demo_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.demo_login_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nazir.demo_login_attempts FROM PUBLIC;
-- One caller may start p_per_caller demo sessions in the window, and everyone together p_overall. A refused attempt is not counted.
CREATE FUNCTION nazir.auth_demo_login_allowed(p_caller text,p_per_caller int,p_window_seconds int,p_overall int) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE mine int; everyone int;
BEGIN
 IF p_caller IS NULL OR p_caller !~ '^[0-9a-f]{64}$' OR p_per_caller NOT BETWEEN 1 AND 1000 OR p_window_seconds NOT BETWEEN 10 AND 86400 OR p_overall NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('auth_demo_login_allowed',0));
 DELETE FROM nazir.demo_login_attempts WHERE at<clock_timestamp()-interval '1 day';
 SELECT count(*) INTO mine FROM nazir.demo_login_attempts WHERE caller_key=p_caller AND at>clock_timestamp()-make_interval(secs=>p_window_seconds);
 SELECT count(*) INTO everyone FROM nazir.demo_login_attempts WHERE at>clock_timestamp()-interval '1 hour';
 IF mine>=p_per_caller OR everyone>=p_overall THEN RETURN false; END IF;
 INSERT INTO nazir.demo_login_attempts(caller_key) VALUES(p_caller);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION nazir.auth_demo_login_allowed(text,int,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_demo_login_allowed(text,int,int,int) TO nazir_auth;
