CREATE TABLE nazir.audit_events (
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 seq bigint NOT NULL,
 at timestamptz NOT NULL,
 actor_type text NOT NULL CHECK(actor_type IN ('member','nazir','system')),
 actor_member_id uuid,
 actor_name_at_event text,
 actor_roles_at_event text[] NOT NULL DEFAULT '{}',
 action text NOT NULL,
 target_type text,
 target_id text,
 payload jsonb NOT NULL DEFAULT '{}',
 prev_hash text NOT NULL,
 hash text NOT NULL,
 PRIMARY KEY(workspace_id,seq),
 FOREIGN KEY(workspace_id,actor_member_id) REFERENCES nazir.members(workspace_id,id)
);
ALTER TABLE nazir.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace ON nazir.audit_events TO nazir_app,nazir_worker
 USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
REVOKE ALL ON nazir.audit_events FROM PUBLIC;
GRANT SELECT ON nazir.audit_events TO nazir_app,nazir_worker;

-- Canonical format is documented in docs/audit-chain.md. chr(31) separates fields.
CREATE FUNCTION nazir.audit_canonical(e nazir.audit_events) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, nazir AS $$
 SELECT array_to_string(ARRAY[
 e.workspace_id::text,e.seq::text,to_char(e.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 e.actor_type,coalesce(e.actor_member_id::text,''),coalesce(e.actor_name_at_event,''),
 coalesce(array_to_string(e.actor_roles_at_event,','),''),e.action,coalesce(e.target_type,''),
 coalesce(e.target_id,''),e.payload::text,e.prev_hash],chr(31))
$$;
CREATE FUNCTION nazir.link_audit() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, nazir AS $$
DECLARE previous nazir.audit_events;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text,0));
 SELECT * INTO previous FROM nazir.audit_events WHERE workspace_id=NEW.workspace_id ORDER BY seq DESC LIMIT 1;
 NEW.seq:=coalesce(previous.seq,0)+1;
 NEW.at:=date_trunc('microseconds',clock_timestamp());
 NEW.prev_hash:=coalesce(previous.hash,repeat('0',64));
 NEW.hash:=encode(sha256(convert_to(nazir.audit_canonical(NEW),'UTF8')),'hex');
 RETURN NEW;
END $$;
CREATE TRIGGER link_audit BEFORE INSERT ON nazir.audit_events FOR EACH ROW EXECUTE FUNCTION nazir.link_audit();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON nazir.audit_events FOR EACH ROW EXECUTE FUNCTION nazir.reject_mutation();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON nazir.audit_events FOR EACH STATEMENT EXECUTE FUNCTION nazir.reject_mutation();

CREATE FUNCTION nazir.append_audit(action text,target_type text,target_id text,payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, nazir AS $$
DECLARE wid uuid; mid uuid; actor text; actor_name text; roles text[];
BEGIN
 wid:=nazir.current_workspace_id();
 IF wid IS NULL THEN RAISE EXCEPTION 'Workspace context required'; END IF;
 IF current_setting('role',true)='nazir_app' THEN
  mid:=nullif(current_setting('app.member_id',true),'')::uuid;
  SELECT display_name INTO actor_name FROM nazir.members WHERE id=mid AND workspace_id=wid AND status='active';
  SELECT coalesce(array_agg(role ORDER BY role),'{}') INTO roles FROM nazir.member_roles WHERE member_id=mid AND workspace_id=wid;
  actor:='member';
 ELSIF current_setting('role',true)='nazir_worker' THEN actor:='nazir'; roles:='{}';
 ELSE RAISE EXCEPTION 'Role context required';
 END IF;
 INSERT INTO nazir.audit_events(workspace_id,actor_type,actor_member_id,actor_name_at_event,actor_roles_at_event,action,target_type,target_id,payload)
 VALUES(wid,actor,mid,actor_name,roles,action,target_type,target_id,coalesce(payload,'{}'));
END $$;

CREATE FUNCTION nazir.bootstrap_workspace(p_user_email text,p_user_name text,p_workspace_name text,p_kind text)
RETURNS TABLE(member_id uuid,workspace_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, nazir AS $$
DECLARE uid uuid; wid uuid; mid uuid; previous_context text;
BEGIN
 IF current_setting('role',true)<>'nazir_worker' THEN RAISE EXCEPTION 'Worker role required'; END IF;
 INSERT INTO nazir.users(email,name) VALUES(lower(p_user_email),p_user_name)
 ON CONFLICT(email) DO UPDATE SET name=excluded.name RETURNING id INTO uid;
 INSERT INTO nazir.workspaces(name,kind,created_by) VALUES(p_workspace_name,p_kind,uid) RETURNING id INTO wid;
 INSERT INTO nazir.members(workspace_id,user_id,display_name) VALUES(wid,uid,p_user_name) RETURNING id INTO mid;
 INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES(wid,mid,'service_owner');
 previous_context:=current_setting('app.workspace_id',true);
 PERFORM set_config('app.workspace_id',wid::text,true);
 PERFORM nazir.append_audit('workspace.created','workspace',wid::text,'{}');
 PERFORM set_config('app.workspace_id',coalesce(previous_context,''),true);
 RETURN QUERY SELECT mid,wid;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nazir FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.current_workspace_id() TO nazir_app,nazir_worker;
GRANT EXECUTE ON FUNCTION nazir.append_audit(text,text,text,jsonb) TO nazir_app,nazir_worker;
GRANT EXECUTE ON FUNCTION nazir.bootstrap_workspace(text,text,text,text) TO nazir_worker;
