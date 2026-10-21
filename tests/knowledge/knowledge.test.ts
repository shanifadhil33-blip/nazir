import { afterAll, beforeAll, expect, it } from 'vitest';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
import { Forbidden } from '../../src/server/http/errors';
import { addKnowledge, listKnowledge, removeKnowledge, searchKnowledge, searchKnowledgeForWorker } from '../../src/server/knowledge/knowledge';
import { chunkText, searchTerms } from '../../src/server/knowledge/chunk';
import { readAgentSettings, saveAgentSettings } from '../../src/server/settings/agent-settings';
import { agentChat } from '../../src/server/agent/chat';

let db: TestDatabase; let owner: string; let reviewer: string; let viewer: string; let other: string; let workspace: string; let otherWorkspace: string; let agentId: string;
const fees = 'Synthetic demo fee table.\n\nService,Fee in AED\nTrade permit renewal,200\nLate renewal penalty,50 per month';
const arabic = 'سياسة خيالية للتجربة: تجديد الرخصة التجارية يتم خلال خمسة أيام عمل بعد اكتمال الأوراق.';
beforeAll(async () => {
  db = await testDatabase();
  const seeded = await seed(db, 'Knowledge');
  owner = seeded.member_id; workspace = seeded.workspace_id; agentId = seeded.ids.agents!;
  reviewer = await db.createMember(workspace, ['quality_reviewer'], 'Khalid Hamdan');
  viewer = await db.createMember(workspace, ['viewer'], 'Hamza Nasser');
  const o = await seed(db, 'OtherKb'); other = o.member_id; otherWorkspace = o.workspace_id;
}, 60000);
afterAll(async () => { await db?.close(); });

it('chunks on paragraph ends, keeps table headers and caps size', () => {
  const rows = ['Service,Fee', ...Array.from({ length: 80 }, (_, i) => `Item ${i},${i * 10}`)].join('\n');
  const parts = chunkText(rows, 300);
  expect(parts.length).toBeGreaterThan(2);
  for (const p of parts) { expect(p.startsWith('Service,Fee')).toBe(true); expect(p.length).toBeLessThanOrEqual(2000); }
  expect(chunkText('  ')).toEqual([]);
  expect(searchTerms("What's the fee; DROP TABLE x -- for the permit?")).toEqual(['fee', 'drop', 'table', 'permit']);
  expect(searchTerms('كم رسوم تجديد الرخصة؟')).toEqual(['رسوم', 'تجديد', 'الرخصة']);
});

it('lets only the owner add, stores the writer name, and finds English and Arabic with free full text search', async () => {
  await expect(addKnowledge(db.driver, reviewer, { pack: 'government', kind: 'price_table', language: 'en', title: 'Fees', body: fees })).rejects.toBeInstanceOf(Forbidden);
  await expect(addKnowledge(db.driver, viewer, { pack: 'government', kind: 'price_table', language: 'en', title: 'Fees', body: fees })).rejects.toBeInstanceOf(Forbidden);
  await expect(addKnowledge(db.driver, owner, { pack: 'schools', kind: 'faq', language: 'en', title: 'Draft', body: 'x' })).rejects.toMatchObject({ code: 'validation' });
  const added = await addKnowledge(db.driver, owner, { pack: 'government', kind: 'price_table', language: 'en', title: 'Synthetic fee table', body: fees });
  expect(added.chunks).toBe(1);
  await addKnowledge(db.driver, owner, { pack: 'government', kind: 'policy', language: 'ar', title: 'سياسة التجديد', body: arabic, agent_id: agentId });
  const list = await listKnowledge(db.driver, viewer);
  expect(list.docs).toHaveLength(2);
  expect(list.can_edit).toBe(false);
  expect(list.docs.every((d) => d.created_by_name.length > 0)).toBe(true);
  expect(list.docs.find((d) => d.agent_id)?.agent_name).toBe('Knowledge');
  const en = await searchKnowledge(db.driver, reviewer, 'How much is the permit renewal fee?');
  expect(en[0]?.title).toBe('Synthetic fee table');
  expect(en[0]?.excerpt).toContain('200');
  // The article, alef forms and agent scope: the agent policy shows only for that agent.
  expect(await searchKnowledge(db.driver, viewer, 'متى يتم تجديد رخصة')).toEqual([]);
  const ar = await searchKnowledge(db.driver, viewer, 'متى يتم تجديد رخصة', agentId);
  expect(ar[0]?.title).toBe('سياسة التجديد');
  // Words only reach the query: a quote and a statement are plain search words.
  expect(Array.isArray(await searchKnowledge(db.driver, viewer, '\'; DROP TABLE nazir.knowledge_docs; --'))).toBe(true);
  expect((await listKnowledge(db.driver, owner)).docs).toHaveLength(2);
});

it('keeps knowledge inside its workspace for members and the worker', async () => {
  expect((await listKnowledge(db.driver, other)).docs).toEqual([]);
  expect(await searchKnowledge(db.driver, other, 'permit renewal fee')).toEqual([]);
  expect((await searchKnowledgeForWorker(db.driver, otherWorkspace, 'permit renewal fee', null))).toEqual([]);
  expect((await searchKnowledgeForWorker(db.driver, workspace, 'permit renewal fee', null))[0]?.title).toBe('Synthetic fee table');
  const direct = await db.member(owner, async (sql) => sql.query('SELECT * FROM nazir.knowledge_docs').then(() => 'read', () => 'refused'));
  expect(direct).toBe('refused');
});

it('answers in chat with cited knowledge, never from the model', async () => {
  const result = await agentChat(db.driver, viewer, { message: 'What does our knowledge base say about the permit renewal fee?' }, null);
  expect(result.tool).toBe('none');
  expect(result.reply.en).toContain('[1] Synthetic fee table');
  expect(result.reply.ar).toContain('من قاعدة المعرفة');
  expect((result.data as { knowledge: unknown[] }).knowledge.length).toBeGreaterThan(0);
  const nothing = await agentChat(db.driver, viewer, { message: 'hello there' }, null);
  expect(nothing.data).toBeNull();
});

it('saves the focus pack in settings, refuses a draft pack, and owners can remove documents', async () => {
  const base = { name: 'Amal Desk', instructions: '', language: 'en', avatar: 'preset:2' };
  expect((await saveAgentSettings(db.driver, owner, base)).focus_pack).toBe('government');
  await expect(saveAgentSettings(db.driver, owner, { ...base, focus_pack: 'schools' })).rejects.toThrow();
  expect((await readAgentSettings(db.driver, viewer)).focus_pack).toBe('government');
  const doc = (await listKnowledge(db.driver, owner)).docs[0]!;
  await expect(removeKnowledge(db.driver, reviewer, doc.id)).rejects.toBeInstanceOf(Forbidden);
  await expect(removeKnowledge(db.driver, other, doc.id)).rejects.toMatchObject({ code: 'not_found' });
  expect(await removeKnowledge(db.driver, owner, doc.id)).toEqual({ removed: true });
  const left = await db.owner.query<{ n: number }>('SELECT count(*)::int AS n FROM nazir.knowledge_chunks WHERE doc_id=$1', [doc.id]);
  expect(left.rows[0]!.n).toBe(0);
});

it('opens test runs for a live pack with its own sandbox, and Government runs as before', async () => {
  const base = { name: 'Amal Desk', instructions: '', language: 'en', avatar: 'preset:2' };
  expect((await saveAgentSettings(db.driver, owner, { ...base, focus_pack: 'real_estate' })).focus_pack).toBe('real_estate');
  const estate = await agentChat(db.driver, owner, { message: 'propose a plan' }, null);
  expect(estate.reply.en).not.toContain('not open yet');
  await saveAgentSettings(db.driver, owner, { ...base, focus_pack: 'government' });
  const again = await agentChat(db.driver, owner, { message: 'propose a plan' }, null);
  expect(again.reply.en).not.toContain('not open yet');
});
