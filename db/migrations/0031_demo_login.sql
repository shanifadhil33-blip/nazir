-- Guarded one tap demo sign in. Four made up people in one fixed demo workspace, nothing else.
-- Fixed ids so the server and the checks below can name them. Emails end in @demo.nazir.test, which no real person can sign in with.
INSERT INTO nazir.users(id,email,name) VALUES
 ('d0000000-0000-4000-8000-000000000001','omar.mansoor@demo.nazir.test','Omar Mansoor'),
 ('d0000000-0000-4000-8000-000000000002','yusuf.haddad@demo.nazir.test','Yusuf Haddad'),
 ('d0000000-0000-4000-8000-000000000003','khalid.rahman@demo.nazir.test','Khalid Rahman'),
 ('d0000000-0000-4000-8000-000000000004','bilal.nasser@demo.nazir.test','Bilal Nasser')
ON CONFLICT DO NOTHING;
INSERT INTO nazir.workspaces(id,name,kind,created_by) VALUES
 ('d0000000-0000-4000-8000-000000000100','Nazir demo','demo','d0000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO nazir.members(id,workspace_id,user_id,display_name) VALUES
 ('d0000000-0000-4000-8000-000000000011','d0000000-0000-4000-8000-000000000100','d0000000-0000-4000-8000-000000000001','Omar Mansoor'),
 ('d0000000-0000-4000-8000-000000000012','d0000000-0000-4000-8000-000000000100','d0000000-0000-4000-8000-000000000002','Yusuf Haddad'),
 ('d0000000-0000-4000-8000-000000000013','d0000000-0000-4000-8000-000000000100','d0000000-0000-4000-8000-000000000003','Khalid Rahman'),
 ('d0000000-0000-4000-8000-000000000014','d0000000-0000-4000-8000-000000000100','d0000000-0000-4000-8000-000000000004','Bilal Nasser')
ON CONFLICT DO NOTHING;
INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES
 ('d0000000-0000-4000-8000-000000000100','d0000000-0000-4000-8000-000000000011','service_owner'),
 ('d0000000-0000-4000-8000-000000000100','d0000000-0000-4000-8000-000000000012','quality_reviewer'),
 ('d0000000-0000-4000-8000-000000000100','d0000000-0000-4000-8000-000000000013','viewer'),
 ('d0000000-0000-4000-8000-000000000100','d0000000-0000-4000-8000-000000000014','supplier_maintainer')
ON CONFLICT DO NOTHING;
-- Same start as a new home workspace (src/server/auth/home-seed.ts): the Government pack and the baseline sample agent.
DO $$
DECLARE aid uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM nazir.agents WHERE workspace_id='d0000000-0000-4000-8000-000000000100') THEN
  INSERT INTO nazir.agents(workspace_id,name) VALUES('d0000000-0000-4000-8000-000000000100','Fictional Service Agent') RETURNING id INTO aid;
  INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,config,config_hash,frozen_at,created_by)
   VALUES('d0000000-0000-4000-8000-000000000100',aid,'baseline v1','baseline','{"registry_id":"baseline"}'::jsonb,'',now(),'d0000000-0000-4000-8000-000000000011');
  INSERT INTO nazir.agent_settings(workspace_id,focus_pack,updated_by) VALUES('d0000000-0000-4000-8000-000000000100','government','d0000000-0000-4000-8000-000000000011')
   ON CONFLICT DO NOTHING;
 END IF;
END $$;

-- A demo person may only ever belong to the demo workspace, and the fixed demo rows cannot be deleted.
CREATE FUNCTION nazir.demo_member_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE demo boolean;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.workspace_id='d0000000-0000-4000-8000-000000000100' THEN RAISE EXCEPTION 'Demo accounts cannot be removed'; END IF;
  RETURN OLD;
 END IF;
 SELECT u.email LIKE '%@demo.nazir.test' INTO demo FROM nazir.users u WHERE u.id=NEW.user_id;
 IF demo AND NEW.workspace_id IS DISTINCT FROM 'd0000000-0000-4000-8000-000000000100'::uuid THEN
  RAISE EXCEPTION 'Demo accounts cannot join other workspaces';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.demo_member_guard() FROM PUBLIC;
CREATE TRIGGER demo_member_guard BEFORE INSERT OR UPDATE ON nazir.members FOR EACH ROW EXECUTE FUNCTION nazir.demo_member_guard();
CREATE TRIGGER demo_member_no_delete BEFORE DELETE ON nazir.members FOR EACH ROW EXECUTE FUNCTION nazir.demo_member_guard();
CREATE FUNCTION nazir.demo_user_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.email LIKE '%@demo.nazir.test' THEN RAISE EXCEPTION 'Demo accounts cannot be removed'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.email LIKE '%@demo.nazir.test' AND NEW.id NOT IN ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004') THEN
  RAISE EXCEPTION 'Demo accounts are fixed';
 END IF;
 IF TG_OP='UPDATE' AND OLD.email LIKE '%@demo.nazir.test' AND NEW.email IS DISTINCT FROM OLD.email THEN RAISE EXCEPTION 'Demo accounts are fixed'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nazir.demo_user_guard() FROM PUBLIC;
CREATE TRIGGER demo_user_guard BEFORE INSERT OR UPDATE OR DELETE ON nazir.users FOR EACH ROW EXECUTE FUNCTION nazir.demo_user_guard();

-- Same as 0009 plus one refusal: a demo person never creates a workspace.
CREATE OR REPLACE FUNCTION nazir.auth_create_workspace(p_user uuid,p_name text) RETURNS TABLE("workspaceId" uuid,"memberId" uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE wid uuid; mid uuid; display text; mail text;
BEGIN
 IF p_user IS DISTINCT FROM nullif(current_setting('app.auth_user_id',true),'')::uuid THEN RAISE EXCEPTION 'Sign in context required'; END IF;
 IF length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Choose a workspace name'; END IF;
 SELECT name,email INTO STRICT display,mail FROM nazir.users WHERE id=p_user;
 IF mail LIKE '%@demo.nazir.test' THEN RAISE EXCEPTION 'Demo accounts cannot create workspaces'; END IF;
 INSERT INTO nazir.workspaces(name,kind,created_by) VALUES(btrim(p_name),'real',p_user) RETURNING id INTO wid;
 INSERT INTO nazir.members(workspace_id,user_id,display_name) VALUES(wid,p_user,display) RETURNING id INTO mid;
 INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES(wid,mid,'service_owner');
 INSERT INTO nazir.audit_events(workspace_id,actor_type,actor_member_id,actor_name_at_event,actor_roles_at_event,action,target_type,target_id,payload)
 VALUES(wid,'member',mid,display,ARRAY['service_owner'],'workspace.created','workspace',wid::text,'{}');
 RETURN QUERY SELECT wid,mid;
END
$$;

-- The only way to start a demo session. Four fixed people, never an arbitrary user id, and a short life.
CREATE FUNCTION nazir.auth_demo_session(p_role text,p_token_hash text,p_expires timestamptz) RETURNS SETOF nazir.auth_sessions
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
 RETURN QUERY INSERT INTO nazir.auth_sessions VALUES(p_token_hash,uid,p_expires) RETURNING *;
END
$$;
REVOKE ALL ON FUNCTION nazir.auth_demo_session(text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_demo_session(text,text,timestamptz) TO nazir_auth;
