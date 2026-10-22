import 'server-only';
import { z } from 'zod';
import { can, type Action, type Role } from '../auth/roles';
import { requireRole, Forbidden } from '../auth/guard';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded, NotFound, errorLines, messageFor, type ErrorCode } from '../http/errors';
import { caseResults, type ReportConversation } from '../reports/build';
import { listFindings } from '../findings/read';
import { packById } from '../packs/catalog';
import { approvePlan } from '../memory/planner';
import { proposeBoundedPlan, startBoundedRun } from '../planner/bound';
import { compareRuns, readComparisons } from '../compare/compare';
import { RepairRefused, resolveExecutable } from '../repair/executable';
import { resolvePackVersion, runtimeForPack } from '../packs/runtime';
import { decideRepair, startRetest, submitRepair } from '../repair/proposals';
import {
  actionErrors, agentTools, asksImpersonation, budgetFrom, causeCopy, exactPlan, exactRepair, identityOverride,
  idsIn, mcpPlan, mcpRepair, planCostReply, replyFor, successReply, type ActionError, type AgentTool, type Bilingual,
} from './intent';

export type AgentResult = { done: boolean; reply: Bilingual; data: unknown };
type Origin = { message?: string };

function refused(kind: string, error: ActionError, partial = false): AgentResult {
  return { done: false, reply: replyFor(partial ? 'partial_start' : kind, false, error), data: { ok: false, error: { code: error.code, message: error.message } } };
}
function finished(kind: string, data: unknown, extra?: Bilingual): AgentResult {
  return { done: true, reply: replyFor(kind, true, undefined, extra), data };
}
function normalize(error: unknown): ActionError {
  if (error instanceof NotFound) return actionErrors.not_found;
  if (error instanceof RepairRefused) return actionErrors.repair;
  if (error instanceof Coded) {
    const line = (errorLines as Record<string, { en: string; ar: string }>)[error.code];
    const code = (line ? error.code : 'failed') as ErrorCode;
    return { code, message: messageFor(code, 'en', error.details), ar: messageFor(code, 'ar', error.details) };
  }
  const text = error instanceof Error ? error.message : '';
  if (text.includes('Another member must decide')) return actionErrors.four_eyes;
  if (text.includes('Plan is not waiting')) return actionErrors.not_waiting;
  if (text.includes('An approved plan is required') || text.includes('Approved plan required') || text.includes('Approved bounded plan')) return actionErrors.not_approved;
  if (text.includes('finished')) return actionErrors.not_finished;
  if (text.includes('Two different runs')) return actionErrors.same_run;
  if (text.includes('Agent version')) return actionErrors.version;
  return actionErrors.failed;
}
async function allow(driver: TransactionDriver, memberId: string, action: Action) {
  await withMember(driver, memberId, async (sql) => { await requireRole(sql, action); });
}
async function attempt(kind: string, work: () => Promise<AgentResult>): Promise<AgentResult> {
  try { return await work(); }
  catch (error) {
    if (error instanceof Forbidden || error instanceof z.ZodError) throw error;
    if (error instanceof Coded && (error.code === 'widens_tools' || error.code === 'impersonation')) throw error;
    return refused(kind, normalize(error));
  }
}
function argId(args: unknown, key: string) {
  if (!args || typeof args !== 'object' || !(key in args)) return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && z.uuid().safeParse(value).success ? value.toLowerCase() : null;
}
function chosenId(origin: Origin, args: unknown, key: string) {
  const fromArgs = argId(args, key);
  if (!origin.message) return fromArgs;
  const fromMessage = idsIn(origin.message)[0] ?? null;
  if (!fromMessage || (fromArgs && fromArgs !== fromMessage)) return null;
  return fromMessage;
}

export async function listRuns(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'run.read');
    const roles = (await sql.query<{ role: Role }>('SELECT role FROM nazir.member_roles WHERE member_id=nazir.current_member_id()')).rows.map((row) => row.role);
    const evidence = can(roles, 'evidence.read');
    const runs = (await sql.query<Record<string, unknown>>(`SELECT id,status,repeat_count,created_at,calls_used,calls_budget,plan_id${evidence ? ',frozen_manifest' : ''} FROM nazir.runs ORDER BY created_at DESC,id LIMIT 50`)).rows;
    for (const run of runs) {
      const rows = (await sql.query<ReportConversation>('SELECT id,status,scenario_id,attempt_number,language FROM nazir.conversations WHERE run_id=$1 ORDER BY created_at,id', [run.id])).rows;
      run.results = caseResults(rows);
    }
    return runs;
  });
}
async function versions(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async (sql) => {
    // A pack with its own sandbox plans against its own baseline; Government keeps the latest version as before.
    const runtime = runtimeForPack((await sql.query<{ p: string }>('SELECT nazir.current_focus_pack() AS p')).rows[0]?.p ?? 'government');
    const agent = runtime
      ? (await sql.query<{ id: string }>("SELECT id FROM nazir.agent_versions WHERE config->>'registry_id'=$1 ORDER BY created_at DESC,id LIMIT 1", [runtime.versions[0]!.id])).rows[0]
      : (await sql.query<{ id: string }>('SELECT id FROM nazir.agent_versions ORDER BY created_at DESC,id LIMIT 1')).rows[0];
    const rules = (await sql.query<{ id: string }>("SELECT id FROM nazir.rule_pack_versions WHERE status='approved' ORDER BY created_at DESC,id LIMIT 1")).rows[0];
    return agent?.id && rules?.id ? { agent_version_id: agent.id, rule_pack_version_id: rules.id } : null;
  });
}
async function planReady(driver: TransactionDriver, memberId: string, planId: string) {
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'plan.approve');
    const plan = (await sql.query<{ status: string; agent_version_id: string; stop_rules: { set?: string; scenario_ids?: string[] } }>('SELECT status,agent_version_id,stop_rules FROM nazir.plans WHERE id=$1', [planId])).rows[0];
    if (!plan) return { status: 'missing' as const, ready: false };
    const version = (await sql.query<{ config: { registry_id?: string; parent_registry_id?: string; patch?: unknown; executable_hash?: string }; config_hash: string }>('SELECT config,config_hash FROM nazir.agent_versions WHERE id=$1', [plan.agent_version_id])).rows[0];
    const packed = version ? resolvePackVersion(version.config as { registry_id?: string; pack_config_hash?: string }) : null;
    const executable = version ? resolveExecutable(version.config) : null;
    const ready = (packed ? (version!.config as { pack_config_hash?: string }).pack_config_hash === packed.version.configHash : !!executable && version?.config_hash === executable.configHash) && plan.stop_rules.set === 'bounded' && (plan.stop_rules.scenario_ids?.length ?? 0) > 0;
    return { status: plan.status, ready };
  });
}
function sentencesOf(value: unknown): Bilingual | undefined {
  const summary = value && typeof value === 'object' && 'summary' in value ? (value as { summary?: { sentences?: { en?: string[]; ar?: string[] } } }).summary : (value as { sentences?: { en?: string[]; ar?: string[] } } | undefined);
  const en = summary?.sentences?.en?.[0];
  const ar = summary?.sentences?.ar?.[0];
  return en && ar ? { en, ar } : undefined;
}

/** A focus pack runs when it has a sandbox runner; a draft pack refuses runs instead of testing the wrong cases. */
async function packRuns(driver: TransactionDriver, memberId: string) {
  const pack = await withMember(driver, memberId, async (sql) => {
    try { return (await sql.query<{ p: string | null }>("SELECT nazir.read_agent_settings()->>'focus_pack' AS p")).rows[0]?.p ?? 'government'; } catch { return 'government'; }
  }).catch(() => 'government');
  const found = packById(pack ?? 'government');
  return found ? found.status === 'live' && found.runner !== 'none' : true;
}
async function propose(driver: TransactionDriver, memberId: string, args: unknown, origin: Origin): Promise<AgentResult> {
  await allow(driver, memberId, 'plan.propose');
  if (!await packRuns(driver, memberId)) return refused('propose_plan', actionErrors.pack_not_running);
  const record = args && typeof args === 'object' ? { ...(args as Record<string, unknown>) } : {};
  if (typeof record.agent_version_id !== 'string') {
    const found = await versions(driver, memberId);
    if (!found) return { done: false, reply: successReply.missing, data: null };
    record.agent_version_id = found.agent_version_id;
    record.rule_pack_version_id = found.rule_pack_version_id;
    const stated = origin.message ? budgetFrom(origin.message) : null;
    if (stated) record.budget = stated;
  }
  const data = await proposeBoundedPlan(driver, memberId, record);
  const calls = data && typeof data === 'object' && 'plannedCalls' in data ? Number(data.plannedCalls) : 0;
  return finished('propose_plan', data, planCostReply(calls));
}
async function startRun(driver: TransactionDriver, memberId: string, args: unknown, origin: Origin): Promise<AgentResult> {
  await allow(driver, memberId, 'plan.approve');
  if (!await packRuns(driver, memberId)) return refused('start_run', actionErrors.pack_not_running);
  const fromMessage = origin.message ? exactPlan(origin.message) : null;
  const fromMcp = origin.message ? null : mcpPlan(args);
  const approval = fromMessage ?? (fromMcp ? { id: fromMcp.plan_id, reason: fromMcp.reason, evidence_opened: true as const } : null);
  const queuedOnly = !origin.message && z.object({ plan_id: z.uuid() }).strict().safeParse(args).success;
  const planId = approval?.id ?? (queuedOnly ? argId(args, 'plan_id') : null) ?? (origin.message && /start the run|ابدأ التشغيل/i.test(origin.message) ? idsIn(origin.message)[0] ?? null : null);
  if (!planId) return refused('start_run', actionErrors.approval_required);
  const state = await planReady(driver, memberId, planId);
  if (state.status === 'missing') return refused('start_run', actionErrors.not_found);
  if (!state.ready) return refused('start_run', actionErrors.version);
  if (state.status === 'approved') {
    const run = await startBoundedRun(driver, memberId, planId);
    return finished('start_run', { plan_id: planId, run_id: run.id });
  }
  if (state.status !== 'proposed' || !approval) return refused('start_run', state.status === 'proposed' ? actionErrors.approval_required : actionErrors.not_waiting);
  try { await approvePlan(driver, memberId, { id: planId, reason: approval.reason, evidence_opened: true, ...(fromMcp?.repeat_count !== undefined ? { repeat_count: fromMcp.repeat_count } : {}) }); }
  catch (error) {
    if (error instanceof Forbidden) throw error;
    return refused('start_run', normalize(error));
  }
  try {
    const run = await startBoundedRun(driver, memberId, planId);
    return finished('start_run', { plan_id: planId, run_id: run.id });
  } catch (error) {
    if (error instanceof Forbidden) throw error;
    return refused('start_run', normalize(error), true);
  }
}
async function explain(driver: TransactionDriver, memberId: string, args: unknown, origin: Origin): Promise<AgentResult> {
  const rows = await listFindings(driver, memberId, {});
  const requested = chosenId(origin, args, 'finding_id');
  if (origin.message && idsIn(origin.message).length > 0 && !requested) return refused('explain_finding', actionErrors.not_found);
  const row = (requested ? rows.find((item) => item.id === requested) : rows[0]) ?? null;
  if (!row) return refused('explain_finding', actionErrors.not_found);
  const cause = causeCopy[String(row.root_cause_class ?? 'unknown')] ?? causeCopy.unknown!;
  const revealed = 'agent_said' in row;
  const data = {
    id: row.id, root_cause_class: row.root_cause_class, cause,
    title: { en: row.title, ar: row.title_ar },
    really_happened: { en: row.really_happened, ar: row.really_happened_ar },
    severity: row.severity, check_id: row.check_id ?? null, language: row.language ?? null,
    ...(revealed ? { said: row.agent_said ?? null, evidence: row.evidence ?? null } : {}),
  };
  return finished('explain_finding', data, cause);
}
async function proposeRepair(driver: TransactionDriver, memberId: string, args: unknown, origin: Origin): Promise<AgentResult> {
  await allow(driver, memberId, 'proposal.create');
  const findingId = chosenId(origin, args, 'finding_id');
  if (!findingId) return refused('propose_repair', actionErrors.not_found);
  if (origin.message && !/propose a repair|اقترح إصلاح|اقترح اصلاح/i.test(origin.message)) return refused('propose_repair', actionErrors.approval_required);
  const row = (await listFindings(driver, memberId)).find((item) => item.id === findingId);
  if (!row) return refused('propose_repair', actionErrors.not_found);
  const happened = String(row.really_happened ?? '').trim();
  const evidence = happened.length >= 3 ? happened.slice(0, 2000) : 'The finding records a failed check.';
  const proposal = await submitRepair(driver, memberId, { finding_id: findingId, evidence });
  return finished('propose_repair', proposal);
}
async function decide(driver: TransactionDriver, memberId: string, args: unknown, origin: Origin): Promise<AgentResult> {
  await allow(driver, memberId, 'proposal.decide');
  const fromMessage = origin.message ? exactRepair(origin.message) : null;
  const fromArgs = origin.message ? null : mcpRepair(args);
  const decision = fromMessage ?? fromArgs;
  if (!decision) return refused('decide_repair', actionErrors.approval_required);
  const result = await decideRepair(driver, memberId, decision);
  return finished(result.status === 'approved' ? 'decide_approve' : 'decide_reject', result);
}
async function rerun(driver: TransactionDriver, memberId: string, args: unknown, origin: Origin): Promise<AgentResult> {
  await allow(driver, memberId, 'plan.approve');
  const proposalId = chosenId(origin, args, 'proposal_id') ?? chosenId(origin, args, 'proposalId');
  if (!proposalId) return refused('rerun_tests', actionErrors.not_found);
  if (origin.message && !/rerun the affected|أعد الاختبارات المتأثرة|اعد الاختبارات المتأثرة/i.test(origin.message)) return refused('rerun_tests', actionErrors.approval_required);
  const runs = await startRetest(driver, memberId, { proposalId, sets: ['retest'] });
  return finished('rerun_tests', runs);
}
async function compare(driver: TransactionDriver, memberId: string, args: unknown, origin: Origin): Promise<AgentResult> {
  const show = origin.message ? /show the comparison|اعرض المقارنة|أظهر المقارنة/i.test(origin.message) : z.object({ read: z.literal(true) }).strict().safeParse(args).success;
  if (show && !(origin.message && /compare(?: the)? runs|قارن التشغيل/i.test(origin.message))) {
    const rows = await readComparisons(driver, memberId);
    if (!rows.length) return finished('empty_comparison', rows);
    return finished('show_comparison', rows, sentencesOf(rows[0]));
  }
  const pair = z.object({ run_a: z.uuid(), run_b: z.uuid() }).strict().safeParse(args);
  const messageIds = origin.message ? idsIn(origin.message) : [];
  const runA = origin.message ? messageIds[0] ?? null : pair.success ? pair.data.run_a.toLowerCase() : null;
  const runB = origin.message ? messageIds[1] ?? null : pair.success ? pair.data.run_b.toLowerCase() : null;
  await allow(driver, memberId, 'comparison.create');
  if (!runA || !runB || runA === runB) return refused('compare_runs', !runA || !runB ? actionErrors.not_found : actionErrors.same_run);
  if (origin.message && !/compare(?: the)? runs|قارن التشغيل/i.test(origin.message)) return refused('compare_runs', actionErrors.approval_required);
  const built = await compareRuns(driver, memberId, { runA, runB });
  return finished('compare_runs', { id: built.id, summary_hash: built.summary_hash, summary: built.summary, parity: built.parity }, sentencesOf(built));
}

/** Every chat and MCP action. Permission checks and audit rows stay in the called services. */
export async function runAgentTool(driver: TransactionDriver, memberId: string, name: string, args: unknown, origin: Origin = {}): Promise<AgentResult> {
  if (identityOverride(args) || (origin.message && asksImpersonation(origin.message))) throw new Coded(403, 'impersonation', actionErrors.impersonation.message);
  if (!(agentTools as readonly string[]).includes(name)) throw new Coded(403, 'widens_tools', 'A plan cannot add tools.');
  const tool = name as AgentTool;
  if (tool === 'list_runs') return attempt(tool, async () => {
    const data = await listRuns(driver, memberId);
    const outcomes = data.flatMap((r) => (r.results ?? []) as { outcome: Bilingual }[]);
    return finished(tool, data, outcomes.length ? { en: outcomes.map((r) => r.outcome.en).join('. '), ar: outcomes.map((r) => r.outcome.ar).join('. ') } : undefined);
  });
  if (tool === 'list_findings') return attempt(tool, async () => finished(tool, await listFindings(driver, memberId, {})));
  if (tool === 'propose_plan') return attempt(tool, () => propose(driver, memberId, args, origin));
  if (tool === 'start_run') return attempt(tool, () => startRun(driver, memberId, args, origin));
  if (tool === 'explain_finding') return attempt(tool, () => explain(driver, memberId, args, origin));
  if (tool === 'propose_repair') return attempt(tool, () => proposeRepair(driver, memberId, args, origin));
  if (tool === 'decide_repair') return attempt(tool, () => decide(driver, memberId, args, origin));
  if (tool === 'rerun_tests') return attempt(tool, () => rerun(driver, memberId, args, origin));
  return attempt(tool, () => compare(driver, memberId, args, origin));
}
