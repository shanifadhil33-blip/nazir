-- Chunk 4. Each person keeps their own language. The shell reads it before the workspace language.
ALTER TABLE nazir.members ADD COLUMN language text CHECK (language IN ('en','ar'));

-- Saves the language for the person calling, never anyone else, and never touches other settings.
CREATE FUNCTION nazir.set_my_language(p_language text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_member_id() IS NULL THEN RAISE EXCEPTION 'Workspace context required'; END IF;
 IF p_language IS NULL OR p_language NOT IN ('en','ar') THEN RAISE EXCEPTION 'Invalid language'; END IF;
 UPDATE nazir.members SET language=p_language WHERE id=nazir.current_member_id() AND workspace_id=nazir.current_workspace_id() AND language IS DISTINCT FROM p_language;
 IF FOUND THEN PERFORM nazir.append_audit('member.language','member',nazir.current_member_id()::text,jsonb_build_object('language',p_language)); END IF;
END $$;

CREATE FUNCTION nazir.my_language() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT language FROM nazir.members WHERE id=nazir.current_member_id() AND workspace_id=nazir.current_workspace_id()
$$;

REVOKE ALL ON FUNCTION nazir.set_my_language(text), nazir.my_language() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.set_my_language(text), nazir.my_language() TO nazir_app;
