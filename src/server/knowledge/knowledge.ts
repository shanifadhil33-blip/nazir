import 'server-only';
import { z } from 'zod';
import { withMember, withWorker } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { Coded, Forbidden } from '../http/errors';
import { livePackIds } from '../packs/catalog';
import { knowledgeKinds, type PackId } from '../packs/schema';
import { chunkText, searchTerms } from './chunk';

export const knowledgeInput = z.object({
  pack: z.string().refine((p) => (livePackIds as string[]).includes(p), 'pack'),
  agent_id: z.uuid().nullable().default(null),
  kind: z.enum(knowledgeKinds),
  language: z.enum(['en', 'ar', 'mixed']),
  title: z.string().trim().min(1).max(120),
  source_name: z.string().trim().max(200).nullable().default(null),
  body: z.string().max(200000).refine((b) => b.trim().length > 0, 'body'),
}).strict();

export type KnowledgeHit = { cite: number; doc_id: string; chunk_id: string; title: string; kind: string; part: number; excerpt: string };
export type KnowledgeList = { docs: { id: string; pack: PackId; agent_id: string | null; agent_name: string | null; kind: string; language: string; title: string; source_name: string | null; chars: number; chunks: number; created_by_name: string; created_at: string }[]; agents: { id: string; name: string }[]; can_edit: boolean };

function refuse(error: unknown): never {
  const message = String((error as Error)?.message);
  if (/cannot do this/.test(message)) throw new Forbidden();
  if (/Knowledge limit/.test(message)) throw new Coded(400, 'validation', 'Check the details and try again.');
  if (/violates foreign key|invalid input syntax/.test(message)) throw new Coded(400, 'validation', 'Check the details and try again.');
  throw error;
}

export async function listKnowledge(driver: TransactionDriver, memberId: string): Promise<KnowledgeList> {
  return withMember(driver, memberId, async (sql) => {
    try { return (await sql.query<{ k: KnowledgeList }>('SELECT nazir.knowledge_list() AS k')).rows[0]!.k; } catch (error) { refuse(error); }
  });
}

export async function addKnowledge(driver: TransactionDriver, memberId: string, value: unknown) {
  const parsed = knowledgeInput.safeParse(value);
  if (!parsed.success) throw new Coded(400, 'validation', 'Check the details and try again.');
  const input = parsed.data;
  const chunks = chunkText(input.body);
  if (!chunks.length || chunks.length > 300) throw new Coded(400, 'validation', 'Check the details and try again.');
  const meta = { pack: input.pack, agent_id: input.agent_id ?? '', kind: input.kind, language: input.language, title: input.title, source_name: input.source_name ?? '', chars: input.body.trim().length };
  const id = await withMember(driver, memberId, async (sql) => {
    try { return (await sql.query<{ id: string }>('SELECT nazir.knowledge_add($1::jsonb,$2::text[]) AS id', [JSON.stringify(meta), chunks])).rows[0]!.id; } catch (error) { refuse(error); }
  });
  return { id, chunks: chunks.length };
}

export async function removeKnowledge(driver: TransactionDriver, memberId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new Coded(404, 'not_found', 'Not found.');
  const gone = await withMember(driver, memberId, async (sql) => {
    try { return (await sql.query<{ ok: boolean }>('SELECT nazir.knowledge_delete($1) AS ok', [id])).rows[0]!.ok; } catch (error) { refuse(error); }
  });
  if (!gone) throw new Coded(404, 'not_found', 'Not found.');
  return { removed: true };
}

type Row = { chunk_id: string; doc_id: string; title: string; kind: string; seq: number; content: string };
const hits = (rows: Row[]): KnowledgeHit[] => rows.map((r, i) => ({ cite: i + 1, doc_id: r.doc_id, chunk_id: r.chunk_id, title: r.title, kind: r.kind, part: Number(r.seq), excerpt: r.content.slice(0, 600) }));
async function find(sql: SqlConnection, fn: string, question: string, agentId: string | null, limit: number) {
  const terms = searchTerms(question);
  if (!terms.length) return [];
  return hits((await sql.query<Row>(`SELECT * FROM nazir.${fn}($1::text[],$2::uuid,$3)`, [terms, agentId, limit])).rows);
}

/** Member search in the workspace's chosen pack. */
export async function searchKnowledge(driver: TransactionDriver, memberId: string, question: string, agentId: string | null = null, limit = 4) {
  if (agentId !== null && !z.uuid().safeParse(agentId).success) agentId = null;
  return withMember(driver, memberId, async (sql) => {
    try { return await find(sql, 'knowledge_search', question.slice(0, 1000), agentId, limit); } catch (error) { refuse(error); }
  });
}

/** Worker search for the judge. Any failure means no context, never a failed run. */
export async function searchKnowledgeForWorker(driver: TransactionDriver, workspaceId: string, question: string, agentId: string | null, limit = 3, pack?: string): Promise<KnowledgeHit[]> {
  try {
    return await withWorker(driver, workspaceId, async (sql) => {
      if (pack) return hits((await sql.query<Row>('SELECT * FROM nazir.knowledge_search_pack_worker($1,$2::text[],$3::uuid,$4)', [pack, searchTerms(question.slice(0, 1000)), agentId, limit])).rows);
      return find(sql, 'knowledge_search_worker', question.slice(0, 1000), agentId, limit);
    });
  } catch { return []; }
}

/** The cited lines Nazir shows in chat. Built from stored text only; the model never writes them. */
export function citedReply(found: KnowledgeHit[]) {
  const lines = found.map((h) => `[${h.cite}] ${h.title}: ${h.excerpt.replace(/\s+/g, ' ').slice(0, 280)}`).join('\n');
  return { en: `From your knowledge base:\n${lines}`, ar: `من قاعدة المعرفة لديك:\n${lines}` };
}
