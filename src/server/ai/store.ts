import type { TransactionDriver, SqlConnection } from '../db/driver';
import type { Family } from './providers';
export type Task = 'test_run' | 'live_demo' | 'probe';
export type Reason = 'ok' | 'no_key' | 'cooling' | 'dropped' | 'forced_down' | 'cap_reached' | 'rate_limited' | 'day_used' | 'payment_required' | 'auth_failed' | 'timeout' | 'http_5xx' | 'network' | 'invalid_response' | 'invalid_tool_args' | 'deadline';
export type Attempt = { provider: string; model: string; family: Family; outcome: 'ok' | 'error' | 'skipped'; reason: Reason; httpStatus: number | null; latencyMs: number };
export type CallRecord = Attempt & { at: number; task: Task; purpose: 'agent' | 'judge'; failover: boolean; attemptNo: number; workspaceId?: string; conversationId?: string };
export type Cooldown = { provider: string; model: string; until: number; reason: Reason };
export type Usage = { day: string; task: Task; provider: string; model: string; calls: number; ok: number; failed: number };
export interface AiStateStore {
  reserve(task: Task, provider: string, model: string, taskCap: number, providerCap: number): Promise<boolean>;
  record(call: CallRecord): Promise<void>;
  cool(cooldown: Cooldown): Promise<void>;
  activeCooldowns(): Promise<Cooldown[]>;
  usageToday(): Promise<Usage[]>;
}
export function memoryAiStore(now: () => number = Date.now): AiStateStore & { records: CallRecord[] } {
  const usage: Usage[] = [], cooldowns: Cooldown[] = [], records: CallRecord[] = [];
  const day = () => new Date(now()).toISOString().slice(0, 10);
  return {
    records,
    async reserve(task, provider, model, taskCap, providerCap) {
      if (!['test_run','live_demo','probe'].includes(task) || !/^[a-z][a-z0-9_]{0,31}$/.test(provider) || !/^[A-Za-z0-9@][A-Za-z0-9_./:@-]{0,127}$/.test(model) || !Number.isSafeInteger(taskCap) || !Number.isSafeInteger(providerCap) || taskCap < 0 || providerCap < 0) throw new Error('Invalid AI reservation');
      const today = usage.filter((row) => row.day === day());
      if (today.filter((row) => row.task === task).reduce((n, row) => n + row.calls, 0) >= taskCap || today.filter((row) => row.provider === provider).reduce((n, row) => n + row.calls, 0) >= providerCap) return false;
      let row = today.find((row) => row.task === task && row.provider === provider && row.model === model);
      if (!row) { row = { day: day(), task, provider, model, calls: 0, ok: 0, failed: 0 }; usage.push(row); }
      row.calls++;
      return true;
    },
    async record(call) {
      records.push(structuredClone(call));
      if (call.outcome === 'skipped' || call.reason === 'forced_down') return;
      const row = usage.find((row) => row.day === new Date(call.at).toISOString().slice(0,10) && row.task === call.task && row.provider === call.provider && row.model === call.model);
      if (row) row[call.outcome === 'ok' ? 'ok' : 'failed']++;
    },
    async cool(cooldown) {
      const previous = cooldowns.find((row) => row.provider === cooldown.provider && row.model === cooldown.model);
      if (!previous) cooldowns.push({ ...cooldown });
      else if (cooldown.until > previous.until) Object.assign(previous, cooldown);
    },
    async activeCooldowns() { return cooldowns.filter((row) => row.until > now()).map((row) => ({ ...row })); },
    async usageToday() { return usage.filter((row) => row.day === day()).map((row) => ({ ...row })); },
  };
}
export function postgresAiStore(driver: TransactionDriver): AiStateStore {
  const run = <T>(work: (db: SqlConnection) => Promise<T>) => driver.transaction(async (db) => { await db.query('SET LOCAL ROLE nazir_worker'); return work(db); });
  return {
    reserve: (task, provider, model, taskCap, providerCap) => run(async (db) => (await db.query<{ reserved: boolean }>('SELECT nazir.ai_reserve($1,$2,$3,$4,$5) AS reserved', [task,provider,model,taskCap,providerCap])).rows[0]!.reserved),
    record: (c) => run(async (db) => { await db.query('SELECT nazir.ai_record($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [new Date(c.at),c.task,c.purpose,c.provider,c.model,c.family,c.outcome,c.reason,c.httpStatus,c.latencyMs,c.failover,c.attemptNo,c.workspaceId ?? null,c.conversationId ?? null]); }),
    cool: (c) => run(async (db) => { await db.query('SELECT nazir.ai_cool($1,$2,$3,$4)', [c.provider,c.model,new Date(c.until),c.reason]); }),
    activeCooldowns: () => run(async (db) => (await db.query<{ provider: string; model: string; until: string | Date; reason: Reason }>('SELECT * FROM nazir.ai_active_cooldowns()')).rows.map((row) => ({ ...row, until: new Date(row.until).getTime() }))),
    usageToday: () => run(async (db) => (await db.query<Usage & Record<string, unknown>>('SELECT * FROM nazir.ai_usage_today()')).rows.map((row) => ({ ...row, day: new Date(row.day).toISOString().slice(0,10) }))),
  };
}
