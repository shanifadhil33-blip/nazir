import 'server-only';
import { z } from 'zod';
import { withMember, withWorker } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded } from '../http/errors';
import { openKey, sealKey } from '../settings/agent-settings';
import { readExternalAgent } from '../settings/external-agent';
import { safeAuthHeader } from '../connect/a2a';

export const identityHeader = (name: string) => safeAuthHeader(name) && !/^(x-nazir-|traceparent$|tracestate$|baggage$|a2a-version$|accept$|authorization-proxy$)/i.test(name);
const person = z.object({ name: z.string().trim().min(1).max(60), reference: z.string().trim().min(1).max(100), token: z.string().min(8).max(2000).regex(/^[\x20-\x7e]+$/) }).strict();
export const testPeopleInput = z.object({ revision: z.uuid(), header: z.string().trim().min(1).max(100).refine(identityHeader), a: person, b: person }).strict().refine(v => v.a.reference !== v.b.reference && v.a.token !== v.b.token);
export type TestPeople = z.infer<typeof testPeopleInput>;
export type TestPeopleView = { id: string; revision: string; configured: true; header: string; a: { name: string; reference: string }; b: { name: string; reference: string } };
export async function readTestPeople(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async sql => (await sql.query<{ people: TestPeopleView | null }>('SELECT nazir.read_safety_test_people() AS people')).rows[0]!.people);
}
export async function saveTestPeople(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = testPeopleInput.parse(value);
  const connection = await readExternalAgent(driver, memberId);
  if (!connection?.ready || connection.revision !== input.revision) throw new Coded(409, 'safety_confirm_needed', 'Check your current connection first.');
  const { revision, header, a, b } = input;
  const metadata = { header, a: { name: a.name, reference: a.reference }, b: { name: b.name, reference: b.reference } };
  try { await withMember(driver, memberId, sql => sql.query('SELECT nazir.save_safety_test_people($1,$2::jsonb,$3)', [revision, JSON.stringify(metadata), sealKey(JSON.stringify(input))])); }
  catch (error) { if (String((error as Error)?.message).includes('safety_connection_changed')) throw new Coded(409, 'safety_confirm_needed', 'Check your current connection first.'); throw error; }
  return readTestPeople(driver, memberId);
}
export async function removeTestPeople(driver: TransactionDriver, memberId: string) {
  await withMember(driver, memberId, sql => sql.query('SELECT nazir.save_safety_test_people(NULL,NULL,NULL)'));
  return { removed: true };
}
/** Only the worker opens this run's frozen credentials. They are removed when the run stops or ends. */
export async function testPeopleForRun(driver: TransactionDriver, workspaceId: string, runId: string): Promise<TestPeople | null> {
  const cipher = await withWorker(driver, workspaceId, async sql => (await sql.query<{ cipher: string }>('SELECT cipher FROM nazir.safety_run_people WHERE run_id=$1', [runId])).rows[0]?.cipher);
  if (!cipher) return null;
  try { return testPeopleInput.parse(JSON.parse(openKey(cipher))); }
  catch { return null; }
}
