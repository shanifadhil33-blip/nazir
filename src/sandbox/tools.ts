import { z } from 'zod';
import { withSandbox } from '../server/db/context';
import type { SqlConnection, TransactionDriver } from '../server/db/driver';
import { demoRulePack, hash, routingMap, rulePackHash, type RoutingMap } from './demo-rule-pack';

const text = z.string().trim().min(1).max(2000);
const reference = z.string().regex(/^NZ-[0-9]{6}$/);
const schemas = {
  get_service_policy: z.strictObject({ clause_id: z.string().max(20).nullish() }),
  create_case: z.strictObject({ category: z.enum(['complaint', 'suggestion', 'information']), summary: text, prior_request_ref: z.string().trim().min(1).max(100), requester_name: z.string().trim().min(1).max(200) }),
  get_case_status: z.strictObject({ reference }),
  request_human_review: z.strictObject({ reference, reason: text }),
};
const descriptions = {
  get_service_policy: 'Read the fictional service rules.',
  create_case: 'Create a case after the requester gives the required details and explicit confirmation.',
  get_case_status: 'Read your case status and human review record.',
  request_human_review: 'Send a case for human review.',
};
export const toolManifest = Object.entries(schemas).map(([name, schema]) => ({ type: 'function' as const, function: { name, description: descriptions[name as keyof typeof schemas], parameters: z.toJSONSchema(schema) } }));
export function toolManifestHash(): string { return hash(toolManifest); }
export type ToolError = 'invalid_arguments' | 'not_found' | 'prior_request_not_found' | 'tool_failed';
export type ToolResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: ToolError };
export type SandboxContext = { driver: TransactionDriver; tenant: string; requesterKey: string };
type CaseRow = { id: string; reference: string; category: keyof RoutingMap; queue: string; status: string };
const failure = (error: ToolError): ToolResult => ({ ok: false, error });
const success = (data: Record<string, unknown>): ToolResult => ({ ok: true, data });
async function caseByReference(db: SqlConnection, tenant: string, ref: string) {
  return (await db.query<CaseRow>('SELECT id,reference,category,queue,status FROM sandbox.cases WHERE tenant=$1 AND reference=$2', [tenant, ref])).rows[0];
}
export function createSandboxTools(context: SandboxContext, version: { routingMap: RoutingMap; faults?: { createCase: 'fail' } } = { routingMap }) {
  async function execute(name: string, args: unknown, options: { idempotencyKey: string }): Promise<ToolResult> {
    const schema = Object.hasOwn(schemas, name) ? schemas[name as keyof typeof schemas] : undefined;
    const parsed = schema?.safeParse(args);
    async function perform(db: SqlConnection): Promise<ToolResult> {
      if (!parsed?.success || !options.idempotencyKey || options.idempotencyKey.length > 1000) return failure('invalid_arguments');
      const tenant = context.tenant;
      if (name === 'get_service_policy') {
        const { clause_id } = schemas.get_service_policy.parse(args);
        const clause = clause_id ? demoRulePack.clauses.find((item) => item.id === clause_id) : undefined;
        if (clause_id && !clause) return failure('not_found');
        return success({ version: demoRulePack.version, hash: rulePackHash(), ...(clause ? { clause } : { clauses: demoRulePack.clauses }) });
      }
      if (name === 'create_case') {
        if (version.faults?.createCase === 'fail') return failure('tool_failed');
        const input = schemas.create_case.parse(args);
        // Serialize matching attempts before checking for the existing record.
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenant + ':' + options.idempotencyKey]);
        const existing = (await db.query<CaseRow>('SELECT id,reference,category,queue,status FROM sandbox.cases WHERE tenant=$1 AND idempotency_key=$2', [tenant, options.idempotencyKey])).rows[0];
        if (existing) return success({ reference: existing.reference, queue: existing.queue, status: existing.status });
        if (input.category === 'complaint') {
          const prior = await db.query("SELECT reference FROM sandbox.prior_requests WHERE tenant=$1 AND reference=$2 AND requester_key=$3 AND status='unresolved'", [tenant, input.prior_request_ref, context.requesterKey]);
          if (!prior.rows.length) return failure('prior_request_not_found');
        }
        const row = (await db.query<CaseRow>(`INSERT INTO sandbox.cases(tenant,requester_key,category,summary,prior_request_ref,queue,idempotency_key)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,reference,category,queue,status`, [tenant, context.requesterKey, input.category, input.summary, input.category === 'complaint' ? input.prior_request_ref : null, version.routingMap[input.category], options.idempotencyKey])).rows[0]!;
        return success({ reference: row.reference, queue: row.queue, status: row.status });
      }
      if (name === 'get_case_status') {
        const input = schemas.get_case_status.parse(args);
        const row = await caseByReference(db, tenant, input.reference);
        if (!row) return failure('not_found');
        const escalation = (await db.query('SELECT id AS escalation_id,queue,status FROM sandbox.escalations WHERE tenant=$1 AND case_id=$2', [tenant, row.id])).rows[0] ?? null;
        return success({ reference: row.reference, status: row.status, queue: row.queue, escalation });
      }
      const input = schemas.request_human_review.parse(args);
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenant + ':' + input.reference]);
      const row = await caseByReference(db, tenant, input.reference);
      if (!row) return failure('not_found');
      const existing = (await db.query('SELECT id AS escalation_id,queue,status FROM sandbox.escalations WHERE tenant=$1 AND case_id=$2', [tenant, row.id])).rows[0];
      if (existing) return success(existing);
      const escalation = (await db.query(`INSERT INTO sandbox.escalations(tenant,case_id,queue,reason,idempotency_key) VALUES($1,$2,$3,$4,$5) RETURNING id AS escalation_id,queue,status`, [tenant, row.id, version.routingMap[row.category], input.reason, options.idempotencyKey])).rows[0]!;
      await db.query("UPDATE sandbox.cases SET status='in_review' WHERE tenant=$1 AND id=$2", [tenant, row.id]);
      return success(escalation);
    }
    return withSandbox(context.driver, context, async (db) => {
      await db.query('SAVEPOINT tool_work');
      let result: ToolResult;
      try { result = await perform(db); await db.query('RELEASE SAVEPOINT tool_work'); }
      catch { await db.query('ROLLBACK TO SAVEPOINT tool_work'); result = failure('tool_failed'); }
      await db.query('INSERT INTO sandbox.tool_receipts(tenant,tool,request,response,outcome) VALUES($1,$2,$3,$4,$5)', [context.tenant, name, JSON.stringify({ arguments: args ?? null, idempotencyKey: options.idempotencyKey }), JSON.stringify(result), result.ok ? 'ok' : 'error']);
      return result;
    });
  }
  return { execute };
}
