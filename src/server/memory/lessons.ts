import 'server-only';
import { z } from 'zod';
import { withMember } from '../db/context';
import { requireRole } from '../auth/guard';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { checkEffect, familyOf, LessonRefused, lessonFamilies, refusals, rememberQuestion, scopeOf, statusLabels, type LessonEffect } from './effects';

export type LessonRow = { id: string; text: string; text_ar: string | null; scope: 'small' | 'big'; status: string; effect: LessonEffect | null; family: string | null; language: string | null;
  source_conversation_ids: string[]; source_finding_ids: string[]; created_by_type: string; created_by: string | null; confirmed_by: string | null; approved_by: string | null; version: number; created_at: string; updated_at: string };
const uuid = z.uuid();
const text = z.string().trim().min(3).max(500);
async function me(sql: SqlConnection) { return (await sql.query<{ id: string }>('SELECT nazir.current_member_id() AS id')).rows[0]!.id; }
async function load(sql: SqlConnection, id: string, lock = true) {
  const row = (await sql.query<LessonRow>(`SELECT * FROM nazir.lessons WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  if (!row) throw new LessonRefused('not_found', refusals.missing);
  return row;
}
async function revision(sql: SqlConnection, before: LessonRow | null, after: LessonRow) {
  await sql.query(`INSERT INTO nazir.lesson_revisions(workspace_id,lesson_id,version,text_before,text_after,status_before,status_after,changed_by,effect_before,effect_after,text_ar_after)
    VALUES(nazir.current_workspace_id(),$1,$2,$3,$4,$5,$6,nazir.current_member_id(),$7::jsonb,$8::jsonb,$9)`,
  [after.id, after.version, before?.text ?? null, after.text, before?.status ?? null, after.status, before?.effect ? JSON.stringify(before.effect) : null, after.effect ? JSON.stringify(after.effect) : null, after.text_ar]);
}
async function audit(sql: SqlConnection, action: string, id: string, payload: Record<string, unknown> = {}) {
  await sql.query('SELECT nazir.append_audit($1,\'lesson\',$2,$3)', [action, id, JSON.stringify(payload)]);
}
async function change(sql: SqlConnection, before: LessonRow, next: Partial<Pick<LessonRow, 'text' | 'text_ar' | 'status' | 'effect' | 'scope' | 'family'>> & { confirm?: boolean; approve?: boolean }) {
  const after = (await sql.query<LessonRow>(`UPDATE nazir.lessons SET text=$2,text_ar=$3,status=$4,effect=$5::jsonb,scope=$6,family=$7,
    confirmed_by=CASE WHEN $8 THEN nazir.current_member_id() ELSE confirmed_by END,approved_by=CASE WHEN $9 THEN nazir.current_member_id() ELSE approved_by END,
    version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
  [before.id, next.text ?? before.text, next.text_ar === undefined ? before.text_ar : next.text_ar, next.status ?? before.status, (next.effect === undefined ? before.effect : next.effect) ? JSON.stringify(next.effect === undefined ? before.effect : next.effect) : null,
    next.scope ?? before.scope, next.family === undefined ? before.family : next.family, !!next.confirm, !!next.approve])).rows[0]!;
  await revision(sql, before, after);
  return after;
}
async function create(sql: SqlConnection, input: { text: string; text_ar?: string | null; language: 'en' | 'ar'; effect: LessonEffect; status: string; createdByType: 'member' | 'nazir'; conversations?: string[]; findings?: string[] }) {
  const row = (await sql.query<LessonRow>(`INSERT INTO nazir.lessons(workspace_id,text,text_ar,scope,status,source_conversation_ids,source_finding_ids,created_by_type,effect,family,language)
    VALUES(nazir.current_workspace_id(),$1,$2,$3,$4,$5::uuid[],$6::uuid[],$7,$8::jsonb,$9,$10) RETURNING *`,
  [input.text, input.text_ar ?? null, scopeOf(input.effect), input.status, input.conversations ?? [], input.findings ?? [], input.createdByType, JSON.stringify(input.effect), familyOf(input.effect), input.language])).rows[0]!;
  await revision(sql, null, row);
  return row;
}
const rememberInput = z.object({ text, text_ar: text.optional(), language: z.enum(['en', 'ar']), effect: z.unknown(), source_conversation_ids: z.array(uuid).max(50).optional(), source_finding_ids: z.array(uuid).max(50).optional() }).strict();
/** A member asks to remember something. Small lessons are active at once; big ones wait for the service owner. */
export async function rememberLessonWith(sql: SqlConnection, value: unknown) {
  const input = rememberInput.parse(value);
  await requireRole(sql, 'lesson.edit');
  const effect = checkEffect(input.effect);
  const row = await create(sql, { ...input, effect, status: scopeOf(effect) === 'big' ? 'waiting_approval' : 'active', createdByType: 'member', conversations: input.source_conversation_ids, findings: input.source_finding_ids });
  await audit(sql, 'lesson.remember', row.id, { scope: row.scope, kind: effect.kind });
  return row;
}
export function rememberLesson(driver: TransactionDriver, memberId: string, value: unknown) { return withMember(driver, memberId, (sql) => rememberLessonWith(sql, value)); }
/** After a reviewer corrects a finding, Nazir asks "Should I remember this?". A one off correction creates nothing. */
export async function suggestLessonFromCorrection(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = z.object({ finding_id: uuid, reason: text, oneOff: z.boolean().optional() }).strict().parse(value);
  if (input.oneOff) return null;
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'lesson.edit');
    const f = (await sql.query<{ id: string; conversation_id: string; check_layer: string; language: 'en' | 'ar' | null; family: string }>('SELECT f.id,f.conversation_id,f.check_layer,f.language,s.family FROM nazir.findings f JOIN nazir.scenarios s ON s.id=f.scenario_id WHERE f.id=$1', [input.finding_id])).rows[0];
    if (!f) throw new LessonRefused('not_found', refusals.missing);
    const known = (lessonFamilies as readonly string[]).includes(f.family);
    const effect: LessonEffect = f.check_layer === 'semantic' && known ? { kind: 'judge_note', family: f.family as (typeof lessonFamilies)[number], note: input.reason } : { kind: 'note' };
    const row = await create(sql, { text: input.reason, language: f.language ?? 'en', effect, status: 'suggested', createdByType: 'nazir', conversations: [f.conversation_id], findings: [f.id] });
    await audit(sql, 'lesson.suggest', row.id, { finding_id: f.id, scope: row.scope });
    return { lesson: row, question: rememberQuestion };
  });
}
export async function answerLessonSuggestion(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = z.object({ id: uuid, answer: z.enum(['yes', 'no']), text: text.optional() }).strict().parse(value);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'lesson.confirm_small');
    const row = await load(sql, input.id);
    if (row.status !== 'suggested') throw new LessonRefused('state', refusals.state);
    const after = input.answer === 'no' ? await change(sql, row, { status: 'rejected' })
      : row.scope === 'big' ? await change(sql, row, { status: 'waiting_approval', text: input.text })
      : await change(sql, row, { status: 'active', text: input.text, confirm: true });
    await audit(sql, 'lesson.answer', row.id, { answer: input.answer, status: after.status });
    return after;
  });
}
export async function listLessons(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'lesson.read');
    const rows = (await sql.query<LessonRow & { confirmed_name: string | null; approved_name: string | null; created_name: string | null }>(`SELECT l.*,c.display_name AS confirmed_name,a.display_name AS approved_name,m.display_name AS created_name
      FROM nazir.lessons l LEFT JOIN nazir.members c ON c.id=l.confirmed_by LEFT JOIN nazir.members a ON a.id=l.approved_by LEFT JOIN nazir.members m ON m.id=l.created_by
      WHERE l.status IN ('active','waiting_approval','suggested') ORDER BY l.updated_at DESC,l.id`)).rows;
    const latest = (await sql.query<{ lessons_used: { lesson_id: string }[] | null }>('SELECT lessons_used FROM nazir.plans WHERE lessons_used IS NOT NULL ORDER BY created_at DESC LIMIT 1')).rows[0]?.lessons_used ?? [];
    return rows.map((r) => ({
      id: r.id, text: r.text, text_ar: r.text_ar, scope: r.scope, status: r.status, label: statusLabels[r.status], effect: r.effect, family: r.family,
      cases: r.source_conversation_ids.length, confirmedBy: r.confirmed_name ?? (r.created_by_type === 'member' ? r.created_name : null), approvedBy: r.approved_name,
      when: r.updated_at, version: r.version, usedInLatestPlan: latest.some((l) => l.lesson_id === r.id),
      ...(r.status === 'suggested' ? { question: rememberQuestion } : {}),
    }));
  });
}
const editInput = z.object({ id: uuid, text: text.optional(), text_ar: text.optional(), effect: z.unknown().optional() }).strict();
export async function editLessonWith(sql: SqlConnection, value: unknown) {
  const input = editInput.parse(value);
  await requireRole(sql, 'lesson.edit');
  const row = await load(sql, input.id);
  if (!['active', 'waiting_approval'].includes(row.status)) throw new LessonRefused('state', refusals.state);
  const effect = input.effect === undefined ? row.effect : checkEffect(input.effect);
  const scope = effect ? scopeOf(effect) : row.scope;
  const effectChanged = JSON.stringify(effect) !== JSON.stringify(row.effect);
  const status = scope === 'big' && (effectChanged || row.status !== 'active') ? 'waiting_approval' : scope === 'small' ? 'active' : row.status;
  const after = await change(sql, row, { text: input.text, text_ar: input.text_ar, effect, scope, family: effect ? familyOf(effect) : row.family, status });
  await audit(sql, 'lesson.edit', row.id, { status: after.status });
  return after;
}
export function editLesson(driver: TransactionDriver, memberId: string, value: unknown) { return withMember(driver, memberId, (sql) => editLessonWith(sql, value)); }
export async function deleteLessonWith(sql: SqlConnection, id: string) {
  uuid.parse(id);
  await requireRole(sql, 'lesson.edit');
  const row = await load(sql, id);
  if (row.status === 'deleted') throw new LessonRefused('state', refusals.state);
  const after = await change(sql, row, { status: 'deleted' });
  await audit(sql, 'lesson.delete', id);
  return after;
}
export function deleteLesson(driver: TransactionDriver, memberId: string, id: string) { return withMember(driver, memberId, (sql) => deleteLessonWith(sql, id)); }
/** Undo writes a new revision with the state before the latest one. History is never rewritten. */
export async function undoLessonWith(sql: SqlConnection, id: string) {
  uuid.parse(id);
  await requireRole(sql, 'lesson.edit');
  const row = await load(sql, id);
  const last = (await sql.query<{ text_before: string | null; status_before: string | null; effect_before: LessonEffect | null }>('SELECT text_before,status_before,effect_before FROM nazir.lesson_revisions WHERE lesson_id=$1 ORDER BY version DESC LIMIT 1', [id])).rows[0];
  if (!last) throw new LessonRefused('state', refusals.state);
  const effect = last.text_before === null ? row.effect : last.effect_before;
  const scope = effect ? scopeOf(effect) : row.scope;
  let status = last.status_before ?? 'deleted';
  // Undo never activates a big lesson by itself: it waits for the service owner again.
  if (status === 'active' && scope === 'big' && row.status !== 'active') status = 'waiting_approval';
  const after = await change(sql, row, { text: last.text_before ?? row.text, effect, scope, family: effect ? familyOf(effect) : row.family, status });
  await audit(sql, 'lesson.undo', id, { status: after.status });
  return after;
}
export function undoLesson(driver: TransactionDriver, memberId: string, id: string) { return withMember(driver, memberId, (sql) => undoLessonWith(sql, id)); }
export async function lessonHistory(driver: TransactionDriver, memberId: string, id: string) {
  uuid.parse(id);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'lesson.read');
    return (await sql.query('SELECT version,text_before,text_after,status_before,status_after,effect_before,effect_after,changed_by,changed_at FROM nazir.lesson_revisions WHERE lesson_id=$1 ORDER BY version', [id])).rows;
  });
}
/** Service owner approves a big lesson with a reason. Never the member who created or last changed it. */
export async function approveBigLesson(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = z.object({ id: uuid, reason: z.string().trim().min(10).max(2000), evidence_opened: z.boolean() }).strict().parse(value);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'lesson.approve_big');
    const row = await load(sql, input.id);
    if (row.scope !== 'big' || row.status !== 'waiting_approval') throw new LessonRefused('state', refusals.state);
    const self = await me(sql);
    const lastBy = (await sql.query<{ changed_by: string | null }>('SELECT changed_by FROM nazir.lesson_revisions WHERE lesson_id=$1 ORDER BY version DESC LIMIT 1', [row.id])).rows[0]?.changed_by;
    if (row.created_by === self || lastBy === self) throw new LessonRefused('role', refusals.role);
    const decision = (await sql.query<{ id: string }>(`INSERT INTO nazir.approvals(workspace_id,subject_type,subject_id,decision,reason,evidence_opened,decided_by,decided_by_name_at_event,decided_by_roles_at_event)
      VALUES(nazir.current_workspace_id(),'lesson',$1,'approve',$2,$3,nazir.current_member_id(),'','{}') RETURNING id`, [row.id, input.reason, input.evidence_opened])).rows[0]!;
    const after = await change(sql, row, { status: 'active', approve: true });
    await audit(sql, 'lesson.approve', row.id, { approval_id: decision.id });
    return after;
  });
}
