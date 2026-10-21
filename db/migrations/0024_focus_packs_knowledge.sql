-- P1 and P2 (21 Oct 2026): the focus pack an agent is tested with, and a knowledge base per pack and per agent.
-- Pack content (cases, rubrics, record checks, refusal policies, compliance list) lives as versioned data in the repo (src/server/packs); only the choice is stored here.
ALTER TABLE nazir.agent_settings ADD COLUMN focus_pack text NOT NULL DEFAULT 'government' CHECK (focus_pack IN ('government','real_estate','ecommerce','clinics','schools'));

CREATE OR REPLACE FUNCTION nazir.read_agent_settings() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE s nazir.agent_settings; owner boolean;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 owner := nazir.member_has_role('service_owner');
 SELECT * INTO s FROM nazir.agent_settings WHERE workspace_id=nazir.current_workspace_id();
 RETURN jsonb_build_object(
  'name', s.name, 'instructions', coalesce(s.instructions,''), 'language', coalesce(s.language,'en'), 'avatar', coalesce(s.avatar,'preset:1'),
  'focus_pack', coalesce(s.focus_pack,'government'),
  'mcp_servers', CASE WHEN owner THEN coalesce(s.mcp_servers,'[]') ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('name',e->>'name','host',substring(e->>'url' from '^https://([^/:?#]+)'))) FROM jsonb_array_elements(s.mcp_servers) e),'[]') END,
  'integrations', coalesce(s.integrations,'[]'),
  'llm', CASE WHEN s.llm_provider IS NULL THEN NULL WHEN owner THEN jsonb_build_object('provider',s.llm_provider,'base_url',s.llm_base_url,'model',s.llm_model,'key_last4',s.llm_key_last4)
              ELSE jsonb_build_object('provider',s.llm_provider,'model',s.llm_model,'has_key',s.llm_key_cipher IS NOT NULL) END,
  'can_edit', owner);
END $$;

CREATE OR REPLACE FUNCTION nazir.save_agent_settings(p jsonb, key_cipher text, key_last4 text, clear_key boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 INSERT INTO nazir.agent_settings(workspace_id) VALUES(nazir.current_workspace_id()) ON CONFLICT DO NOTHING;
 UPDATE nazir.agent_settings SET
  name=nullif(p->>'name',''), instructions=coalesce(p->>'instructions',''), language=coalesce(p->>'language','en'), avatar=coalesce(p->>'avatar','preset:1'),
  focus_pack=coalesce(nullif(p->>'focus_pack',''),focus_pack),
  mcp_servers=coalesce(p->'mcp_servers','[]'), integrations=coalesce(p->'integrations','[]'),
  llm_provider=nullif(p->>'llm_provider',''), llm_base_url=nullif(p->>'llm_base_url',''), llm_model=nullif(p->>'llm_model',''),
  llm_key_cipher=CASE WHEN clear_key OR nullif(p->>'llm_provider','') IS NULL THEN NULL WHEN key_cipher IS NOT NULL THEN key_cipher ELSE llm_key_cipher END,
  llm_key_last4=CASE WHEN clear_key OR nullif(p->>'llm_provider','') IS NULL THEN NULL WHEN key_cipher IS NOT NULL THEN key_last4 ELSE llm_key_last4 END,
  updated_by=nazir.current_member_id(), updated_at=clock_timestamp()
 WHERE workspace_id=nazir.current_workspace_id();
 PERFORM nazir.append_audit_internal('agent.settings_saved','workspace',nazir.current_workspace_id()::text,jsonb_build_object('key_changed',key_cipher IS NOT NULL OR clear_key,'provider',p->>'llm_provider','focus_pack',p->>'focus_pack'));
END $$;

-- Arabic and English text folded the same way for the index and the query: lower case, no tashkeel or tatweel, one alef, ta marbuta and alef maqsura folded, the article removed.
CREATE FUNCTION nazir.kb_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT regexp_replace(translate(regexp_replace(lower(coalesce(t,'')),'[ًٌٍَُِّْـ]','','g'),'أإآٱةى','ااااهي'),'(^|[^a-z0-9ء-ي٠-٩])(وال|بال|كال|فال|لل|ال)([ء-ي]{2,})','\1\3','g') $$;

CREATE TABLE nazir.knowledge_docs (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id) ON DELETE CASCADE,
 UNIQUE(workspace_id,id),
 pack text NOT NULL CHECK (pack IN ('government','real_estate','ecommerce','clinics','schools')),
 agent_id uuid,
 FOREIGN KEY (workspace_id,agent_id) REFERENCES nazir.agents(workspace_id,id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('policy','price_table','faq','compliance','other')),
 language text NOT NULL CHECK (language IN ('en','ar','mixed')),
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
 source_name text CHECK (source_name IS NULL OR char_length(source_name) <= 200),
 chars int NOT NULL CHECK (chars BETWEEN 1 AND 200000),
 chunk_count int NOT NULL DEFAULT 0,
 created_by uuid,
 created_by_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE nazir.knowledge_chunks (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 workspace_id uuid NOT NULL,
 doc_id uuid NOT NULL,
 FOREIGN KEY (workspace_id,doc_id) REFERENCES nazir.knowledge_docs(workspace_id,id) ON DELETE CASCADE,
 seq int NOT NULL CHECK (seq >= 1),
 UNIQUE(doc_id,seq),
 content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
 tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', nazir.kb_norm(content))) STORED
);
CREATE INDEX knowledge_chunks_tsv ON nazir.knowledge_chunks USING gin(tsv);
CREATE INDEX knowledge_docs_pack ON nazir.knowledge_docs(workspace_id,pack);
ALTER TABLE nazir.knowledge_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.knowledge_docs FORCE ROW LEVEL SECURITY;
ALTER TABLE nazir.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE nazir.knowledge_chunks FORCE ROW LEVEL SECURITY;
-- No table grants to app or worker: only the definer functions below touch rows. The policies are a second fence.
CREATE POLICY knowledge_docs_workspace ON nazir.knowledge_docs TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
CREATE POLICY knowledge_chunks_workspace ON nazir.knowledge_chunks TO nazir_app,nazir_worker USING(workspace_id=nazir.current_workspace_id()) WITH CHECK(workspace_id=nazir.current_workspace_id());
REVOKE ALL ON nazir.knowledge_docs, nazir.knowledge_chunks FROM PUBLIC;

-- Owners add. Chunks are cut on the server (src/server/knowledge) and stored with the document in one transaction.
CREATE FUNCTION nazir.knowledge_add(p jsonb, chunks text[]) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE new_id uuid; i int;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 IF (SELECT count(*) FROM nazir.knowledge_docs WHERE workspace_id=nazir.current_workspace_id()) >= 200 THEN RAISE EXCEPTION 'Knowledge limit reached.'; END IF;
 IF coalesce(array_length(chunks,1),0) < 1 OR array_length(chunks,1) > 300 THEN RAISE EXCEPTION 'Check the details and try again.'; END IF;
 INSERT INTO nazir.knowledge_docs(workspace_id,pack,agent_id,kind,language,title,source_name,chars,chunk_count,created_by,created_by_name)
 VALUES(nazir.current_workspace_id(),p->>'pack',nullif(p->>'agent_id','')::uuid,p->>'kind',p->>'language',p->>'title',nullif(p->>'source_name',''),(p->>'chars')::int,array_length(chunks,1),nazir.current_member_id(),nazir.my_member_name()) RETURNING id INTO new_id;
 FOR i IN 1..array_length(chunks,1) LOOP
  INSERT INTO nazir.knowledge_chunks(workspace_id,doc_id,seq,content) VALUES(nazir.current_workspace_id(),new_id,i,chunks[i]);
 END LOOP;
 PERFORM nazir.append_audit_internal('knowledge.added','knowledge_doc',new_id::text,jsonb_build_object('pack',p->>'pack','kind',p->>'kind','chunks',array_length(chunks,1)));
 RETURN new_id;
END $$;

CREATE FUNCTION nazir.knowledge_delete(p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE gone int;
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT nazir.member_has_role('service_owner') THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 DELETE FROM nazir.knowledge_docs WHERE id=p_id AND workspace_id=nazir.current_workspace_id();
 GET DIAGNOSTICS gone = ROW_COUNT;
 IF gone > 0 THEN PERFORM nazir.append_audit_internal('knowledge.removed','knowledge_doc',p_id::text,'{}'); END IF;
 RETURN gone > 0;
END $$;

CREATE FUNCTION nazir.knowledge_list() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN jsonb_build_object(
  'docs', coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'pack',d.pack,'agent_id',d.agent_id,'agent_name',a.name,'kind',d.kind,'language',d.language,'title',d.title,'source_name',d.source_name,'chars',d.chars,'chunks',d.chunk_count,'created_by_name',d.created_by_name,'created_at',d.created_at) ORDER BY d.created_at DESC)
    FROM nazir.knowledge_docs d LEFT JOIN nazir.agents a ON a.id=d.agent_id AND a.workspace_id=d.workspace_id WHERE d.workspace_id=nazir.current_workspace_id()),'[]'),
  'agents', coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) ORDER BY a.created_at) FROM nazir.agents a WHERE a.workspace_id=nazir.current_workspace_id()),'[]'),
  'can_edit', nazir.member_has_role('service_owner'));
END $$;

-- Free search: Postgres full text over folded text, any term matches, best rank first. Agent documents apply only to that agent; pack documents to every agent.
CREATE FUNCTION nazir.knowledge_find(p_pack text, p_terms text[], p_agent uuid, p_limit int) RETURNS TABLE(chunk_id uuid, doc_id uuid, title text, kind text, seq int, content text, rank real) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE q tsquery;
BEGIN
 SELECT to_tsquery('simple', string_agg(quote_literal(t) || ':*', ' | ')) INTO q
  FROM (SELECT DISTINCT nazir.kb_norm(x) AS t FROM unnest(p_terms) x) s WHERE t ~ '^[a-z0-9ء-ي٠-٩]{2,40}$';
 IF q IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT c.id, d.id, d.title, d.kind, c.seq, c.content, ts_rank(c.tsv,q)
  FROM nazir.knowledge_chunks c JOIN nazir.knowledge_docs d ON d.id=c.doc_id AND d.workspace_id=c.workspace_id
  WHERE c.workspace_id=nazir.current_workspace_id() AND d.pack=p_pack AND (d.agent_id IS NULL OR d.agent_id=p_agent) AND c.tsv @@ q
  ORDER BY 7 DESC, d.created_at, c.seq LIMIT least(greatest(coalesce(p_limit,4),1),8);
END $$;

CREATE FUNCTION nazir.knowledge_search(p_terms text[], p_agent uuid, p_limit int) RETURNS TABLE(chunk_id uuid, doc_id uuid, title text, kind text, seq int, content text, rank real) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF nazir.current_workspace_id() IS NULL OR NOT (nazir.member_can_work() OR nazir.member_has_role('viewer')) THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN QUERY SELECT * FROM nazir.knowledge_find(coalesce((SELECT s.focus_pack FROM nazir.agent_settings s WHERE s.workspace_id=nazir.current_workspace_id()),'government'),p_terms,p_agent,p_limit);
END $$;

CREATE FUNCTION nazir.knowledge_search_worker(p_terms text[], p_agent uuid, p_limit int) RETURNS TABLE(chunk_id uuid, doc_id uuid, title text, kind text, seq int, content text, rank real) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF current_setting('role',true)<>'nazir_worker' OR nazir.current_workspace_id() IS NULL THEN RAISE EXCEPTION 'Your role cannot do this.'; END IF;
 RETURN QUERY SELECT * FROM nazir.knowledge_find(coalesce((SELECT s.focus_pack FROM nazir.agent_settings s WHERE s.workspace_id=nazir.current_workspace_id()),'government'),p_terms,p_agent,p_limit);
END $$;

REVOKE ALL ON FUNCTION nazir.kb_norm(text), nazir.knowledge_add(jsonb,text[]), nazir.knowledge_delete(uuid), nazir.knowledge_list(), nazir.knowledge_find(text,text[],uuid,int), nazir.knowledge_search(text[],uuid,int), nazir.knowledge_search_worker(text[],uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.knowledge_add(jsonb,text[]), nazir.knowledge_delete(uuid), nazir.knowledge_list(), nazir.knowledge_search(text[],uuid,int) TO nazir_app;
GRANT EXECUTE ON FUNCTION nazir.knowledge_search_worker(text[],uuid,int) TO nazir_worker;
