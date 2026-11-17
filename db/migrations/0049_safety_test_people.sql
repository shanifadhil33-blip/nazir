-- Staging identities are encrypted, revision bound and never returned by the app read projection.
CREATE TABLE nazir.safety_test_people (
 workspace_id uuid PRIMARY KEY REFERENCES nazir.workspaces(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 connection_revision uuid NOT NULL,
 metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=2000),
 cipher text NOT NULL CHECK (octet_length(cipher)<=16000)
);
CREATE TABLE nazir.safety_run_people (
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 run_id uuid PRIMARY KEY,
 cipher text NOT NULL CHECK (octet_length(cipher)<=16000),
 FOREIGN KEY(workspace_id,run_id) REFERENCES nazir.safety_runs(workspace_id,id)
);
ALTER TABLE nazir.safety_test_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.safety_test_people FORCE ROW LEVEL SECURITY;
ALTER TABLE nazir.safety_run_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.safety_run_people FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nazir.safety_test_people,nazir.safety_run_people FROM PUBLIC;
CREATE POLICY safety_people_worker_read ON nazir.safety_run_people FOR SELECT TO nazir_worker USING (workspace_id=nazir.current_workspace_id());
GRANT SELECT ON nazir.safety_run_people TO nazir_worker;

CREATE FUNCTION nazir.read_safety_test_people() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE p nazir.safety_test_people;
BEGIN
 IF NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 SELECT t.* INTO p FROM nazir.safety_test_people t JOIN nazir.external_agents a ON a.workspace_id=t.workspace_id AND a.revision=t.connection_revision WHERE t.workspace_id=nazir.current_workspace_id();
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN p.metadata||jsonb_build_object('id',p.id,'revision',p.connection_revision,'configured',true);
END $$;
CREATE FUNCTION nazir.save_safety_test_people(p_revision uuid,p_metadata jsonb,p_cipher text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NOT nazir.member_has_role('service_owner') OR NOT EXISTS(SELECT FROM nazir.workspaces WHERE id=nazir.current_workspace_id() AND kind='real') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF p_cipher IS NULL THEN
  DELETE FROM nazir.safety_test_people WHERE workspace_id=nazir.current_workspace_id();
  DELETE FROM nazir.safety_run_people WHERE workspace_id=nazir.current_workspace_id();
  PERFORM nazir.append_audit('safety.people_removed','workspace',nazir.current_workspace_id()::text,'{}');
  RETURN;
 END IF;
 PERFORM 1 FROM nazir.external_agents WHERE workspace_id=nazir.current_workspace_id() AND revision=p_revision AND tested_at IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'safety_connection_changed'; END IF;
 IF jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' OR p_metadata IS NULL OR p_metadata-ARRAY['header','a','b']<>'{}'::jsonb
 OR jsonb_typeof(p_metadata->'a') IS DISTINCT FROM 'object' OR jsonb_typeof(p_metadata->'b') IS DISTINCT FROM 'object'
 OR (p_metadata->'a')-ARRAY['name','reference']<>'{}'::jsonb OR (p_metadata->'b')-ARRAY['name','reference']<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Invalid test people'; END IF;
 IF jsonb_typeof(p_metadata->'header') IS DISTINCT FROM 'string' OR char_length(p_metadata->>'header') NOT BETWEEN 1 AND 100
 OR jsonb_typeof(p_metadata#>'{a,name}') IS DISTINCT FROM 'string' OR char_length(p_metadata#>>'{a,name}') NOT BETWEEN 1 AND 60
 OR jsonb_typeof(p_metadata#>'{b,name}') IS DISTINCT FROM 'string' OR char_length(p_metadata#>>'{b,name}') NOT BETWEEN 1 AND 60
 OR jsonb_typeof(p_metadata#>'{a,reference}') IS DISTINCT FROM 'string' OR char_length(p_metadata#>>'{a,reference}') NOT BETWEEN 1 AND 100
 OR jsonb_typeof(p_metadata#>'{b,reference}') IS DISTINCT FROM 'string' OR char_length(p_metadata#>>'{b,reference}') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid test people'; END IF;
 INSERT INTO nazir.safety_test_people(workspace_id,connection_revision,metadata,cipher) VALUES(nazir.current_workspace_id(),p_revision,p_metadata,p_cipher)
 ON CONFLICT(workspace_id) DO UPDATE SET id=gen_random_uuid(),connection_revision=excluded.connection_revision,metadata=excluded.metadata,cipher=excluded.cipher;
 PERFORM nazir.append_audit('safety.people_saved','workspace',nazir.current_workspace_id()::text,jsonb_build_object('revision',p_revision));
END $$;

-- Connection changes wipe both saved identities and credentials waiting in a test.
CREATE FUNCTION nazir.clear_safety_people_on_connection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 DELETE FROM nazir.safety_test_people WHERE workspace_id=OLD.workspace_id;
 DELETE FROM nazir.safety_run_people WHERE workspace_id=OLD.workspace_id;
 RETURN NULL;
END $$;
CREATE TRIGGER clear_safety_people_on_connection AFTER UPDATE OF revision OR DELETE ON nazir.external_agents FOR EACH ROW EXECUTE FUNCTION nazir.clear_safety_people_on_connection();
-- A finished/stopped/paused test keeps its verdict, never its temporary login credentials.
CREATE FUNCTION nazir.clear_safety_run_people() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NEW.status IN ('done','stopped','paused') THEN DELETE FROM nazir.safety_run_people WHERE run_id=NEW.id; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER clear_safety_run_people AFTER UPDATE OF status ON nazir.safety_runs FOR EACH ROW EXECUTE FUNCTION nazir.clear_safety_run_people();
REVOKE ALL ON FUNCTION nazir.read_safety_test_people(),nazir.save_safety_test_people(uuid,jsonb,text),nazir.clear_safety_people_on_connection(),nazir.clear_safety_run_people() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.read_safety_test_people(),nazir.save_safety_test_people(uuid,jsonb,text) TO nazir_app;

DROP FUNCTION nazir.safety_start(text,text,text,text,jsonb);
CREATE OR REPLACE FUNCTION nazir.safety_start(p_scope text,p_canary text,p_revision text,p_agent_name text,p_attacks jsonb,p_people uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE wid uuid:=nazir.current_workspace_id(); rid uuid; a jsonb; i int:=0; demo boolean; people nazir.safety_test_people;
BEGIN
 IF NOT nazir.member_can_work() OR wid IS NULL THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('safety:'||wid::text,0));
 SELECT kind='demo' INTO demo FROM nazir.workspaces WHERE id=wid;
 IF NOT demo THEN
  PERFORM 1 FROM nazir.external_agents WHERE workspace_id=wid FOR SHARE;
  IF NOT nazir.safety_is_confirmed(p_revision::uuid) THEN RAISE EXCEPTION 'safety_confirm_needed'; END IF;
  IF p_scope NOT IN ('full','replies_only') OR p_scope IS NULL THEN RAISE EXCEPTION 'safety_sdk_needed'; END IF;
  IF p_scope='full' AND NOT nazir.safety_sdk_fresh(p_revision::uuid) THEN RAISE EXCEPTION 'safety_sdk_needed'; END IF;
 ELSE
  IF p_scope IS DISTINCT FROM 'sample' THEN RAISE EXCEPTION 'safety_sdk_needed'; END IF;
 END IF;
 SELECT id INTO rid FROM nazir.safety_runs WHERE workspace_id=wid AND status IN ('queued','running') LIMIT 1;
 IF rid IS NOT NULL THEN RETURN rid; END IF;
 IF nazir.safety_next_at() IS NOT NULL THEN RAISE EXCEPTION 'safety_daily_limit'; END IF;
 IF NOT demo AND p_people IS NOT NULL THEN
  SELECT * INTO people FROM nazir.safety_test_people WHERE workspace_id=wid AND id=p_people AND connection_revision=p_revision::uuid FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'safety_people_changed'; END IF;
 END IF;
 IF jsonb_typeof(p_attacks)<>'array' OR jsonb_array_length(p_attacks) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Invalid attacks'; END IF;
 INSERT INTO nazir.safety_runs(workspace_id,started_by,scope,canary,connection_revision,agent_name) VALUES(wid,nazir.current_member_id(),p_scope,p_canary,p_revision,left(p_agent_name,80)) RETURNING id INTO rid;
 IF people.cipher IS NOT NULL THEN INSERT INTO nazir.safety_run_people(workspace_id,run_id,cipher) VALUES(wid,rid,people.cipher); END IF;
 FOR a IN SELECT * FROM jsonb_array_elements(p_attacks) LOOP
  IF NOT demo AND a->>'family'='S10' AND people.cipher IS NULL THEN a:=a||'{"needs":"test_people"}'::jsonb; END IF;
  i:=i+1;
  INSERT INTO nazir.safety_attempts(workspace_id,run_id,position,attack,family,language,status,outcome)
   VALUES(wid,rid,i,a,a->>'family',a->>'language',CASE WHEN a ? 'needs' THEN 'done' ELSE 'queued' END,CASE WHEN a ? 'needs' THEN 'not_run' END);
 END LOOP;
 PERFORM nazir.append_audit('safety.started','safety_run',rid::text,jsonb_build_object('scope',p_scope,'attacks',i));
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION nazir.safety_start(text,text,text,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.safety_start(text,text,text,text,jsonb,uuid) TO nazir_app;
