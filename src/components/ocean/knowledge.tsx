'use client';

import { useCallback, useEffect, useState } from 'react';
import { fill, type Lang, type Messages } from './copy';

type Doc = { id: string; pack: string; agent_id: string | null; agent_name: string | null; kind: Kind; language: string; title: string; chars: number; chunks: number; created_by_name: string };
type Hit = { cite: number; title: string; excerpt: string };
type Kind = 'policy' | 'price_table' | 'faq' | 'compliance' | 'other';
const kinds: Kind[] = ['policy', 'price_table', 'faq', 'compliance', 'other'];

/** Its own card with its own requests: a slow or failed upload never blocks saving the other settings. */
export function KnowledgeCard({ copy, lang, workspaceId, pack, sample }: { copy: Messages; lang: Lang; workspaceId?: string; pack: string; sample: boolean }) {
  const t = copy.settings;
  const [docs, setDocs] = useState<Doc[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [edit, setEdit] = useState(false);
  const [load, setLoad] = useState<'loading' | 'ready' | 'failed'>(sample || !workspaceId ? 'ready' : 'loading');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('policy');
  const [language, setLanguage] = useState<'en' | 'ar' | 'mixed'>(lang);
  const [scope, setScope] = useState('');
  const [body, setBody] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'adding' | 'added' | 'failed' | 'file'>('idle');
  const [question, setQuestion] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const headers = { 'accept-language': lang };

  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (sample || !workspaceId) return;
    let cancel = false;
    fetch(`/api/workspaces/${workspaceId}/knowledge`, { headers: { 'accept-language': lang } })
      .then((r) => r.ok ? r.json() as Promise<{ docs: Doc[]; agents: { id: string; name: string }[]; can_edit: boolean }> : null)
      .catch(() => null)
      .then((value) => {
        if (cancel) return;
        if (!value) { setLoad('failed'); return; }
        setDocs(value.docs); setAgents(value.agents); setEdit(value.can_edit); setLoad('ready');
      });
    return () => { cancel = true; };
  }, [lang, sample, workspaceId, tick]);

  function readFile(file: File | undefined) {
    if (!file) return;
    const okType = /\.(txt|md|markdown|csv)$/i.test(file.name) || /^text\//.test(file.type);
    if (!okType || file.size > 300 * 1024) { setState('file'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') { setBody(reader.result); setFileName(file.name); if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, '').slice(0, 120)); setState('idle'); } };
    reader.readAsText(file);
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!workspaceId || sample) return;
    setState('adding');
    const response = await fetch(`/api/workspaces/${workspaceId}/knowledge`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ pack, agent_id: scope || null, kind, language, title: title.trim(), source_name: fileName, body }) }).catch(() => null);
    if (response?.ok) { setTitle(''); setBody(''); setFileName(null); setState('added'); refresh(); } else setState('failed');
  }

  async function remove(id: string) {
    if (!workspaceId) return;
    const response = await fetch(`/api/workspaces/${workspaceId}/knowledge/${id}`, { method: 'DELETE', headers }).catch(() => null);
    if (response?.ok) setDocs((list) => list.filter((d) => d.id !== id));
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!workspaceId || sample || !question.trim()) return;
    const response = await fetch(`/api/workspaces/${workspaceId}/knowledge/search?q=${encodeURIComponent(question.trim())}`, { headers }).catch(() => null);
    const value = response?.ok ? await response.json().catch(() => null) as { results: Hit[] } | null : null;
    setHits(value?.results ?? []);
  }

  const shown = docs.filter((d) => d.pack === pack);
  return <section className="nz-settings-card nz-kb" data-card="knowledge" aria-labelledby="nz-kb-title">
    <h3 id="nz-kb-title">{t.kb}</h3>
    <p className="nz-hint">{t.kbHint}</p>
    {sample ? <p className="nz-note">{t.kbSample}</p> : null}
    {load === 'failed' ? <p className="nz-note" data-note="kb-failed">{t.kbLoadFailed}</p> : null}
    <ul className="nz-kb-list" data-list="knowledge">
      {shown.length ? shown.map((d) => <li key={d.id} data-doc={d.id}>
        <div><strong>{d.title}</strong><small>{t.kbKinds[d.kind]} · {d.agent_name ?? t.kbAllAgents} · {fill(t.kbParts, { chunks: String(d.chunks) })} · {fill(t.kbBy, { name: d.created_by_name })}</small></div>
        {edit ? <button type="button" className="nz-btn nz-btn-ghost" data-action="remove-knowledge" onClick={() => void remove(d.id)}>{t.kbRemove}</button> : null}
      </li>) : <li className="nz-kb-empty">{t.kbEmpty}</li>}
    </ul>
    {edit && !sample ? <form className="nz-kb-form" onSubmit={add} data-form="add-knowledge">
      <label>{t.kbTitle}<input name="kb-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
      <div className="nz-row">
        <label>{t.kbKind}<select name="kb-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{kinds.map((k) => <option key={k} value={k}>{t.kbKinds[k]}</option>)}</select></label>
        <label>{t.kbLanguage}<select name="kb-language" value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'ar' | 'mixed')}><option value="en">{t.english}</option><option value="ar">{t.arabic}</option><option value="mixed">{t.kbMixed}</option></select></label>
        <label>{t.kbScope}<select name="kb-scope" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">{t.kbAllAgents}</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      </div>
      <label>{t.kbText}<textarea name="kb-body" rows={6} value={body} maxLength={200000} dir="auto" onChange={(e) => { setBody(e.target.value); setFileName(null); }} /></label>
      <label className="nz-upload">{t.kbFile}<input type="file" accept=".txt,.md,.markdown,.csv,text/plain,text/markdown,text/csv" onChange={(e) => readFile(e.target.files?.[0])} /></label>
      <p className="nz-hint">{state === 'file' ? t.kbFileBad : t.kbFileHint}</p>
      <div className="nz-settings-foot">
        <p className="nz-hint" role="status">{state === 'added' ? t.kbAdded : state === 'failed' ? t.kbFailed : ''}</p>
        <button type="submit" className="nz-btn nz-btn-rust" data-action="add-knowledge" disabled={state === 'adding' || !title.trim() || !body.trim()}>{state === 'adding' ? t.kbAdding : t.kbAdd}</button>
      </div>
    </form> : null}
    {!sample ? <form className="nz-row nz-kb-search" onSubmit={search} data-form="search-knowledge">
      <input aria-label={t.kbSearch} placeholder={t.kbSearch} value={question} maxLength={300} dir="auto" onChange={(e) => setQuestion(e.target.value)} />
      <button type="submit" className="nz-btn nz-btn-ghost" data-action="search-knowledge" disabled={!question.trim()}>{t.kbSearchGo}</button>
    </form> : null}
    {hits ? <ol className="nz-kb-hits" data-list="knowledge-hits">{hits.length ? hits.map((h) => <li key={h.cite}><strong>[{h.cite}] {h.title}</strong><p dir="auto">{h.excerpt}</p></li>) : <li>{t.kbNoHits}</li>}</ol> : null}
  </section>;
}
