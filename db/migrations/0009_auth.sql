CREATE ROLE nazir_auth NOLOGIN;
GRANT USAGE ON SCHEMA nazir TO nazir_auth;
CREATE TABLE nazir.auth_accounts (
 user_id uuid NOT NULL REFERENCES nazir.users(id),
 provider text NOT NULL CHECK(provider='google'), provider_account_id text NOT NULL,
 PRIMARY KEY(provider,provider_account_id)
);
CREATE TABLE nazir.auth_sessions (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL REFERENCES nazir.users(id), expires timestamptz NOT NULL
);
CREATE INDEX ON nazir.auth_sessions(expires);
ALTER TABLE nazir.auth_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.auth_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE nazir.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.auth_sessions FORCE ROW LEVEL SECURITY;
CREATE FUNCTION nazir.auth_create_user(p_email text,p_name text,p_image text) RETURNS SETOF nazir.users
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
INSERT INTO nazir.users(email,name,image) VALUES(lower(p_email),coalesce(p_name,''),p_image) RETURNING *
$$;
REVOKE ALL ON FUNCTION nazir.auth_create_user(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_create_user(text,text,text) TO nazir_auth;
CREATE FUNCTION nazir.auth_get_user(p_id uuid) RETURNS SETOF nazir.users
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
SELECT * FROM nazir.users WHERE id=p_id
$$;
REVOKE ALL ON FUNCTION nazir.auth_get_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_get_user(uuid) TO nazir_auth;
CREATE FUNCTION nazir.auth_get_email(p_email text) RETURNS SETOF nazir.users
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
SELECT * FROM nazir.users WHERE email=lower(p_email)
$$;
REVOKE ALL ON FUNCTION nazir.auth_get_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_get_email(text) TO nazir_auth;
CREATE FUNCTION nazir.auth_get_account(p_provider text,p_account text) RETURNS SETOF nazir.users
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
SELECT u.* FROM nazir.users u JOIN nazir.auth_accounts a ON a.user_id=u.id WHERE a.provider=p_provider AND a.provider_account_id=p_account
$$;
REVOKE ALL ON FUNCTION nazir.auth_get_account(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_get_account(text,text) TO nazir_auth;
CREATE FUNCTION nazir.auth_update_user(p_id uuid,p_data jsonb) RETURNS SETOF nazir.users
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
UPDATE nazir.users SET email=CASE WHEN p_data ? 'email' THEN lower(p_data->>'email') ELSE email END,name=CASE WHEN p_data ? 'name' THEN coalesce(p_data->>'name','') ELSE name END,image=CASE WHEN p_data ? 'image' THEN p_data->>'image' ELSE image END WHERE id=p_id RETURNING *
$$;
REVOKE ALL ON FUNCTION nazir.auth_update_user(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_update_user(uuid,jsonb) TO nazir_auth;
CREATE FUNCTION nazir.auth_link_account(p_user uuid,p_provider text,p_account text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
INSERT INTO nazir.auth_accounts VALUES(p_user,p_provider,p_account)
$$;
REVOKE ALL ON FUNCTION nazir.auth_link_account(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_link_account(uuid,text,text) TO nazir_auth;
CREATE FUNCTION nazir.auth_unlink_account(p_provider text,p_account text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DELETE FROM nazir.auth_accounts WHERE provider=p_provider AND provider_account_id=p_account
$$;
REVOKE ALL ON FUNCTION nazir.auth_unlink_account(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_unlink_account(text,text) TO nazir_auth;
CREATE FUNCTION nazir.auth_create_session(p_hash text,p_user uuid,p_expires timestamptz) RETURNS SETOF nazir.auth_sessions
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
INSERT INTO nazir.auth_sessions VALUES(p_hash,p_user,p_expires) RETURNING *
$$;
REVOKE ALL ON FUNCTION nazir.auth_create_session(text,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_create_session(text,uuid,timestamptz) TO nazir_auth;
CREATE FUNCTION nazir.auth_read_session(p_hash text) RETURNS TABLE(user_data jsonb,expires timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 DELETE FROM nazir.auth_sessions s WHERE s.expires<=clock_timestamp();
 RETURN QUERY SELECT to_jsonb(u),s.expires FROM nazir.auth_sessions s JOIN nazir.users u ON u.id=s.user_id WHERE s.token_hash=p_hash;
END
$$;
REVOKE ALL ON FUNCTION nazir.auth_read_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_read_session(text) TO nazir_auth;
CREATE FUNCTION nazir.auth_update_session(p_hash text,p_expires timestamptz) RETURNS SETOF nazir.auth_sessions
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
UPDATE nazir.auth_sessions SET expires=coalesce(p_expires,expires) WHERE token_hash=p_hash AND expires>clock_timestamp() RETURNING *
$$;
REVOKE ALL ON FUNCTION nazir.auth_update_session(text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_update_session(text,timestamptz) TO nazir_auth;
CREATE FUNCTION nazir.auth_delete_session(p_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DELETE FROM nazir.auth_sessions WHERE token_hash=p_hash
$$;
REVOKE ALL ON FUNCTION nazir.auth_delete_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_delete_session(text) TO nazir_auth;
CREATE FUNCTION nazir.auth_memberships(p_user uuid) RETURNS TABLE("workspaceId" uuid,"workspaceName" text,kind text,"memberId" uuid,roles text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF p_user IS DISTINCT FROM nullif(current_setting('app.auth_user_id',true),'')::uuid THEN RAISE EXCEPTION 'Sign in context required'; END IF;
 RETURN QUERY SELECT w.id,w.name,w.kind,m.id,coalesce(array_agg(r.role ORDER BY r.role) FILTER(WHERE r.role IS NOT NULL),'{}') FROM nazir.members m JOIN nazir.workspaces w ON w.id=m.workspace_id LEFT JOIN nazir.member_roles r ON r.member_id=m.id WHERE m.user_id=p_user AND m.status='active' GROUP BY w.id,m.id;
END
$$;
REVOKE ALL ON FUNCTION nazir.auth_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_memberships(uuid) TO nazir_auth;
CREATE FUNCTION nazir.auth_create_workspace(p_user uuid,p_name text) RETURNS TABLE("workspaceId" uuid,"memberId" uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE wid uuid; mid uuid; display text;
BEGIN
 IF p_user IS DISTINCT FROM nullif(current_setting('app.auth_user_id',true),'')::uuid THEN RAISE EXCEPTION 'Sign in context required'; END IF;
 IF length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Choose a workspace name'; END IF;
 SELECT name INTO STRICT display FROM nazir.users WHERE id=p_user;
 INSERT INTO nazir.workspaces(name,kind,created_by) VALUES(btrim(p_name),'real',p_user) RETURNING id INTO wid;
 INSERT INTO nazir.members(workspace_id,user_id,display_name) VALUES(wid,p_user,display) RETURNING id INTO mid;
 INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES(wid,mid,'service_owner');
 INSERT INTO nazir.audit_events(workspace_id,actor_type,actor_member_id,actor_name_at_event,actor_roles_at_event,action,target_type,target_id,payload)
 VALUES(wid,'member',mid,display,ARRAY['service_owner'],'workspace.created','workspace',wid::text,'{}');
 RETURN QUERY SELECT wid,mid;
END
$$;
REVOKE ALL ON FUNCTION nazir.auth_create_workspace(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.auth_create_workspace(uuid,text) TO nazir_auth;
