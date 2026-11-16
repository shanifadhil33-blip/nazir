-- Chunk 6. The bell counts what finished since you last opened it.
ALTER TABLE nazir.members ADD COLUMN seen_at timestamptz;

CREATE FUNCTION nazir.my_seen_at() RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT seen_at FROM nazir.members WHERE id=nazir.current_member_id() AND workspace_id=nazir.current_workspace_id()
$$;
CREATE FUNCTION nazir.mark_seen(p_through timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_member_id() IS NULL THEN RAISE EXCEPTION 'Workspace context required'; END IF;
 UPDATE nazir.members SET seen_at=greatest(seen_at,least(p_through,clock_timestamp())) WHERE id=nazir.current_member_id() AND workspace_id=nazir.current_workspace_id();
END $$;
REVOKE ALL ON FUNCTION nazir.my_seen_at(), nazir.mark_seen(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.my_seen_at(), nazir.mark_seen(timestamptz) TO nazir_app;
