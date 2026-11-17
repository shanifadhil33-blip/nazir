import 'server-only';
import { randomBytes } from 'node:crypto';
import { withMember, withWorker } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded } from '../http/errors';
import type { TraceSpan } from '../checks/trace-checks';
import { externalConversation } from '../runner/external-agent';
import { scheduleRunner } from '../runner/schedule';
import { externalAgentForWorker, readExternalAgent, type ExternalTransport } from '../settings/external-agent';
import { attacksFor, type Attack, type Family } from './attacks';
import { demoInstructions, demoOtherPerson, demoSafetyAgent } from './demo-agent';
import { judgeAttack, type Verdict } from './evidence';
import { readAgentMap } from './read-map';
import { demoInventory, mapFromInventory } from './map';
import { freshSdk, safetyOwnership, verifyDomainProof } from './ownership';

const refusedCodes: Record<string, [number, string, string]> = {
  safety_confirm_needed: [409, 'safety_confirm_needed', 'Confirm you own this agent first.'],
  safety_connection_changed: [409, 'safety_confirm_needed', 'Confirm your current agent first.'],
  safety_sdk_needed: [409, 'safety_proof_needed', 'Connect the SDK or verify your agent website first.'],
  safety_daily_limit: [429, 'safety_daily_limit', 'You have used today\'s safety tests.'],
};
function refuse(error: unknown): never {
  const message = String((error as Error)?.message ?? '');
  for (const [key, [status, code, text]] of Object.entries(refusedCodes)) if (message.includes(key)) throw new Coded(status, code, text);
  throw error;
}

/** I own this agent or have written permission to test it. Logged with the host of the connected agent. */
export async function confirmSafety(driver: TransactionDriver, memberId: string, options: ExternalTransport = {}) {
  const connection = await readExternalAgent(driver, memberId);
  if (!connection?.ready || !connection.revision) throw new Coded(409, 'no_agent', 'Connect your agent first.');
  const sdk = freshSdk(connection);
  if (!sdk) {
    const { proof, confirmed } = await safetyOwnership(driver, memberId, connection);
    if (confirmed) return { confirmed: true };
    if (proof) await verifyDomainProof(proof, options);
    // An already verified current connection needs no additional network request.
  }
  try { await withMember(driver, memberId, (sql) => sql.query('SELECT nazir.safety_confirm($1,$2)', [connection.revision, sdk ? 'sdk' : 'domain'])); }
  catch (error) { refuse(error); }
  return { confirmed: true };
}

/** Test safety: one tap starts one safety test that runs on the server, phone closed or not. */
export async function startSafety(driver: TransactionDriver, memberId: string, kind: 'real' | 'demo' | undefined) {
  const canary = `NZC-${randomBytes(4).toString('hex').toUpperCase()}`;
  let scope: 'full' | 'replies_only' | 'sample' = 'sample', revision: string | null = null, name = 'City Help Desk';
  let attacks: Attack[];
  if (kind === 'demo') attacks = attacksFor(mapFromInventory(demoInventory, null), canary, { testPeople: true });
  else {
    const connection = await readExternalAgent(driver, memberId);
    if (!connection?.ready) throw new Coded(409, 'no_agent', 'Connect your agent first.');
    // The full suite needs the SDK to have said hello in the last day; otherwise it is judged from replies only.
    const fresh = freshSdk(connection);
    scope = fresh ? 'full' : 'replies_only'; revision = connection.revision ?? null; name = connection.name;
    attacks = attacksFor(await readAgentMap(driver, memberId, kind), canary);
  }
  const id = await withMember(driver, memberId, async (sql) => {
    try { return (await sql.query<{ id: string }>('SELECT nazir.safety_start($1,$2,$3,$4,$5::jsonb) AS id', [scope, canary, revision, name, JSON.stringify(attacks)])).rows[0]!.id; }
    catch (error) { refuse(error); }
  });
  scheduleRunner();
  return { id };
}

export async function stopSafety(driver: TransactionDriver, memberId: string, runId: string) {
  await withMember(driver, memberId, (sql) => sql.query('SELECT nazir.safety_stop($1)', [runId]));
  return { stopped: true };
}

/** Only the demo sample can be fixed inside Nazir. */
export async function approveSafetyFix(driver: TransactionDriver, memberId: string, family: string, kind: 'real' | 'demo' | undefined) {
  if (kind !== 'demo') throw new Coded(409, 'own_agent', 'Change your agent, then test again.');
  await withMember(driver, memberId, (sql) => sql.query('SELECT nazir.safety_fix_approve($1)', [family]));
  return { approved: true };
}

type Pending = { run_id: string; workspace_id: string; started_by: string };
type RunRow = { id: string; scope: 'full' | 'replies_only' | 'sample'; status: string; canary: string; connection_revision: string | null; errors_in_row: number };
type AttemptRow = { id: string; attack: Attack };

export async function safetyPending(driver: TransactionDriver): Promise<Pending[]> {
  return driver.transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_worker'); return (await sql.query<Pending>('SELECT * FROM nazir.safety_pending()')).rows; });
}

/** Runs up to four attacks of each waiting safety test, then closes tests that have nothing left. */
export async function safetyStep(driver: TransactionDriver, options: { transport?: ExternalTransport; turnGapMs?: number } = {}) {
  let advanced = false;
  for (const item of await safetyPending(driver)) {
    const work = <T>(fn: Parameters<typeof withWorker<T>>[2]) => withWorker(driver, item.workspace_id, fn);
    const run = await work(async (sql) => {
      await sql.query("UPDATE nazir.safety_runs SET status='running',started_at=coalesce(started_at,clock_timestamp()) WHERE id=$1 AND status='queued'", [item.run_id]);
      return (await sql.query<RunRow>('SELECT id,scope,status,canary,connection_revision,errors_in_row FROM nazir.safety_runs WHERE id=$1', [item.run_id])).rows[0];
    });
    if (!run || run.status !== 'running') continue;
    const claimed = await work(async (sql) => (await sql.query<AttemptRow>(
      `UPDATE nazir.safety_attempts SET status='running',lease_until=clock_timestamp()+interval '90 seconds'
       WHERE id IN (SELECT id FROM nazir.safety_attempts WHERE run_id=$1 AND (status='queued' OR (status='running' AND lease_until<clock_timestamp())) ORDER BY position LIMIT 4 FOR UPDATE SKIP LOCKED)
       RETURNING id,attack`, [run.id])).rows);
    if (claimed.length) {
      advanced = true;
      const fixed = run.scope === 'sample' ? new Set((await work(async (sql) => (await sql.query<{ family: Family }>("SELECT family FROM nazir.safety_fixes WHERE approved_at>clock_timestamp()-interval '1 hour'")).rows)).map((r) => r.family)) : new Set<Family>();
      const results = await Promise.allSettled(claimed.map(async (attempt, index) => {
        // At most one message every 2 s per question, four questions at a time.
        await new Promise((r) => setTimeout(r, index * 500));
        return { attempt, verdict: await runAttack(driver, item.workspace_id, run, attempt.attack, fixed, options.transport, options.turnGapMs ?? 2000) };
      }));
      let errors = run.errors_in_row;
      for (const [index, result] of results.entries()) {
        const attempt = claimed[index]!;
        const ok = result.status === 'fulfilled';
        const v: Verdict & { reply: string } = ok ? result.value.verdict : { outcome: 'could_not_tell', severity: null, proven: null, did: null, reply: '', note: undefined };
        errors = ok ? 0 : errors + 1;
        await work((sql) => sql.query(`UPDATE nazir.safety_attempts SET status='done',outcome=$2,severity=$3,proven=$4,reply=$5,did=$6,note=$7,finished_at=clock_timestamp(),lease_until=NULL WHERE id=$1 AND status='running'`,
          [attempt.id, v.outcome, v.severity, v.proven, v.reply.slice(0, 4000), v.did?.slice(0, 2000) ?? null, ok ? v.note ?? null : 'agent_error']));
      }
      // Circuit breaker: five errors in a row and the test pauses instead of hammering your agent.
      await work((sql) => sql.query(`UPDATE nazir.safety_runs SET errors_in_row=$2,status=CASE WHEN $2>=5 THEN 'paused' ELSE status END WHERE id=$1 AND status='running'`, [run.id, errors]));
    }
    await work(async (sql) => {
      const left = (await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM nazir.safety_attempts WHERE run_id=$1 AND status<>'done'", [run.id])).rows[0]!.n;
      if (left === 0) {
        const closed = await sql.query("UPDATE nazir.safety_runs SET status='done',finished_at=clock_timestamp() WHERE id=$1 AND status='running' RETURNING id", [run.id]);
        if (closed.rows.length) await sql.query("SELECT nazir.append_audit('safety.finished','safety_run',$1,'{}')", [run.id]);
      }
    });
  }
  return { advanced };
}

async function runAttack(driver: TransactionDriver, workspaceId: string, run: RunRow, attack: Attack, fixed: ReadonlySet<Family>, transport: ExternalTransport | undefined, turnGapMs: number): Promise<Verdict & { reply: string }> {
  const changing = demoInventory.tools!.filter((t) => t.changes_data).map((t) => String(t.name));
  if (run.scope === 'sample') {
    const out = demoSafetyAgent(attack, fixed, run.canary);
    const reply = out.replies.at(-1) ?? '';
    return { ...judgeAttack({ attack, reply, spans: out.spans, canaryHit: false, canary: run.canary, changingTools: changing, inventoryTools: demoInventory.tools!.map((t) => String(t.name)), other: demoOtherPerson, fingerprints: [demoInstructions] }), reply };
  }
  const row = await externalAgentForWorker(driver, workspaceId);
  if (!row?.tested_at || row.revision !== run.connection_revision) return { outcome: 'not_run', severity: null, proven: null, did: null, reply: '', note: 'agent_changed' };
  const session = await withWorker(driver, workspaceId, async (sql) => (await sql.query<{ s: string }>("SELECT nazir.open_test_session('security') AS s")).rows[0]!.s);
  // At most one message every 2 s per question.
  let sent = 0;
  const pace = async () => { if (sent++ && turnGapMs) await new Promise((r) => setTimeout(r, turnGapMs)); };
  const result = await externalConversation(row, attack.turns, session, attack.language, pace, transport, { workspaceId, session, mode: 'security', inject: attack.inject }, {});
  let spans: TraceSpan[] | null = null;
  if (run.scope === 'full') {
    for (let tries = 0; tries < 8; tries++) {
      const found = await withWorker(driver, workspaceId, async (sql) => (await sql.query<TraceSpan>('SELECT turn,kind,name,status,attributes FROM nazir.trace_spans WHERE session_id=$1 ORDER BY id', [session])).rows).catch(() => [] as TraceSpan[]);
      if (found.some((s) => s.kind === 'nazir.turn.end' && s.turn === result.replies.length) || tries === 7) { spans = found.some((s) => s.kind === 'nazir.hello') ? found : null; break; }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const inventory = await withWorker(driver, workspaceId, async (sql) => (await sql.query<{ inventory: { tools?: { name?: string; changes_data?: boolean }[] } }>('SELECT inventory FROM nazir.agent_inventory ORDER BY received_at DESC LIMIT 1')).rows[0]?.inventory ?? {}).catch(() => ({} as { tools?: { name?: string; changes_data?: boolean }[] }));
  const tools = (inventory.tools ?? []).filter((t) => typeof t.name === 'string');
  const canaryHit = await withWorker(driver, workspaceId, async (sql) => (await sql.query<{ n: number }>('SELECT count(*)::int AS n FROM nazir.canary_hits WHERE run_id=$1', [run.id])).rows[0]!.n > 0);
  return { ...judgeAttack({ attack, reply: result.reply, spans, canaryHit, canary: run.canary, changingTools: tools.filter((t) => t.changes_data).map((t) => t.name!), inventoryTools: tools.map((t) => t.name!) }), reply: result.reply };
}
