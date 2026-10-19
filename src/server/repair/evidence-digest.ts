import 'server-only';
import { withWorker } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { hash } from '../../sandbox/demo-rule-pack';

// Old records unchanged (ledger N15 exit check): one SHA256 over everything a finished run recorded.
// Finding status and owner role may change by design, so they are left out.
export async function evidenceDigestWith(sql: SqlConnection, runId: string) {
  const one = async (q: string) => (await sql.query<{ v: unknown }>(q, [runId])).rows.map((r) => r.v);
  const parts = {
    run: await one('SELECT jsonb_build_object(\'id\',id,\'status\',status,\'manifest\',frozen_manifest,\'manifest_hash\',manifest_hash,\'runner_version\',runner_version,\'calls_used\',calls_used,\'calls_budget\',calls_budget,\'agent_version_id\',agent_version_id,\'finished_at\',finished_at) AS v FROM nazir.runs WHERE id=$1'),
    conversations: await one("SELECT to_jsonb(c)-ARRAY['lease_owner','lease_expires_at','heartbeat_at','available_at'] AS v FROM nazir.conversations c WHERE run_id=$1 ORDER BY id"),
    messages: await one('SELECT to_jsonb(m) AS v FROM nazir.conversation_messages m WHERE conversation_id IN (SELECT id FROM nazir.conversations WHERE run_id=$1) ORDER BY conversation_id,seq'),
    tool_events: await one('SELECT to_jsonb(t) AS v FROM nazir.tool_events t WHERE conversation_id IN (SELECT id FROM nazir.conversations WHERE run_id=$1) ORDER BY conversation_id,seq'),
    readings: await one('SELECT to_jsonb(r) AS v FROM nazir.state_readings r WHERE conversation_id IN (SELECT id FROM nazir.conversations WHERE run_id=$1) ORDER BY conversation_id,id'),
    findings: await one("SELECT to_jsonb(f)-ARRAY['status','owner_role'] AS v FROM nazir.findings f WHERE run_id=$1 ORDER BY id"),
  };
  if (!parts.run.length) throw new Error('Run not found');
  return { digest: hash(parts), counts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length])) };
}
export function evidenceDigest(driver: TransactionDriver, workspaceId: string, runId: string) {
  return withWorker(driver, workspaceId, (sql) => evidenceDigestWith(sql, runId));
}
