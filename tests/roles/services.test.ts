import { afterAll, beforeAll, expect, it } from 'vitest';
import { roles, type Role } from '../../src/server/auth/roles';
import { Forbidden, NotFound, errorResponse, mapError } from '../../src/server/http/errors';
import * as services from '../../src/server/services';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
let db: TestDatabase;
let a: Awaited<ReturnType<typeof seed>>;
let b: Awaited<ReturnType<typeof seed>>;
const members = {} as Record<Role, string>;
let nextVersion = 10;
beforeAll(async () => {
  db = await testDatabase(); a = await seed(db, 'Services'); b = await seed(db, 'Other');
  for (const role of roles) members[role] = await db.createMember(a.workspace_id, [role], role);
});
afterAll(async () => { await db?.close(); });
const operations = [
  { name: 'draftRulePackVersion', allowed: ['supplier_maintainer', 'service_owner'], input: (s: typeof a) => ({ rule_pack_id: s.ids.rule_packs, version: nextVersion++, content: { rule: 'Example' } }) },
  { name: 'approveRulePackVersion', allowed: ['service_owner'], input: (s: typeof a) => ({ id: s.ids.rule_pack_versions, reason: 'Reviewed evidence', evidence_opened: true }) },
  { name: 'registerAdapter', allowed: ['supplier_maintainer'], input: (s: typeof a) => ({ agent_id: s.ids.agents, kind: 'http', base_url: 'https://api.example.com/v1', allowed_hosts: ['https://api.example.com'], tool_manifest: {} }) },
  { name: 'proposeRepair', allowed: ['supplier_maintainer'], input: (s: typeof a) => ({ finding_id: s.ids.findings, evidence: 'Read the evidence', patch: { change: true } }) },
  { name: 'decideProposal', allowed: ['quality_reviewer'], input: (s: typeof a) => ({ id: s.ids.proposals, decision: 'approve', reason: 'Reviewed evidence', evidence_opened: true }) },
  { name: 'overrideFinding', allowed: ['quality_reviewer'], input: (s: typeof a) => ({ id: s.ids.findings, reason: 'Reviewed evidence', evidence_opened: true }) },
  { name: 'recordReleaseDecision', allowed: ['service_owner'], input: (s: typeof a) => ({ id: s.ids.runs, decision: 'approve', reason: 'Reviewed evidence', evidence_opened: true }) },
] as const;
for (const operation of operations) {
  for (const role of roles) it(`${operation.name} with ${role}`, async () => {
    const work = services[operation.name](db.driver, members[role], operation.input(a));
    if ((operation.allowed as readonly string[]).includes(role)) expect(await work).toHaveProperty('id');
    else {
      const error = await work.catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Forbidden); expect(mapError(error).status).toBe(403);
    }
  });
  it(`${operation.name} refuses another workspace`, async () => {
    const error = await services[operation.name](db.driver, members[operation.allowed[0]], operation.input(b)).catch((error: unknown) => error);
    expect(error instanceof NotFound || error instanceof Forbidden).toBe(true);
    expect([403, 404]).toContain(mapError(error).status);
  });
  it(`${operation.name} validates input`, async () => {
    const error = await services[operation.name](db.driver, members.service_owner, {}).catch((error: unknown) => error);
    expect(mapError(error).status).toBe(400);
  });
}
it('applies four eyes to a supplier who also reviews', async () => {
  const both = await db.createMember(a.workspace_id, ['supplier_maintainer', 'quality_reviewer'], 'Both');
  const own = await services.proposeRepair(db.driver, both, { finding_id: a.ids.findings, evidence: 'Evidence read', patch: {} });
  await expect(services.decideProposal(db.driver, both, { id: own.id, decision: 'approve', reason: 'Checked', evidence_opened: true })).rejects.toBeInstanceOf(Forbidden);
  const other = await services.proposeRepair(db.driver, members.supplier_maintainer, { finding_id: a.ids.findings, evidence: 'Evidence read', patch: {} });
  expect(await services.decideProposal(db.driver, both, { id: other.id, decision: 'approve', reason: 'Checked', evidence_opened: true })).toMatchObject({ status: 'approved' });
});
it('requires a different owner for a rule version', async () => {
  const draft = await services.draftRulePackVersion(db.driver, members.service_owner, { rule_pack_id: a.ids.rule_packs, version: nextVersion++, content: {} });
  const input = { id: draft.id, reason: 'Checked', evidence_opened: true };
  await expect(services.approveRulePackVersion(db.driver, members.service_owner, input)).rejects.toBeInstanceOf(Forbidden);
  expect(await services.approveRulePackVersion(db.driver, a.member_id, input)).toMatchObject({ status: 'approved' });
  expect((await db.owner.query('SELECT approved_by,approved_at FROM nazir.rule_pack_versions WHERE id=$1', [draft.id])).rows[0]).toMatchObject({ approved_by: a.member_id, approved_at: expect.anything() });
});
it('rejects a proposal with a reason and snapshots the decision actor', async () => {
  const proposal = await services.proposeRepair(db.driver, members.supplier_maintainer, { finding_id: a.ids.findings, evidence: 'Evidence read', patch: {} });
  const result = await services.decideProposal(db.driver, members.quality_reviewer, { id: proposal.id, decision: 'reject', reason: 'Needs more evidence', evidence_opened: false });
  expect(result.status).toBe('rejected');
  expect((await db.owner.query('SELECT reason,evidence_opened,decided_by_name_at_event,decided_by_roles_at_event FROM nazir.approvals WHERE id=$1', [result.approval_id])).rows[0]).toEqual({ reason: 'Needs more evidence', evidence_opened: false, decided_by_name_at_event: 'quality_reviewer', decided_by_roles_at_event: ['quality_reviewer'] });
});
it('preserves service audit actor snapshots after membership changes', async () => {
  const member = await db.createMember(a.workspace_id, ['supplier_maintainer'], 'Before');
  const result = await services.proposeRepair(db.driver, member, { finding_id: a.ids.findings, evidence: 'Evidence read', patch: {} });
  await db.owner.query("UPDATE nazir.members SET display_name='After' WHERE id=$1", [member]);
  await db.owner.query("INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES($1,$2,'quality_reviewer')", [a.workspace_id, member]);
  expect((await db.owner.query('SELECT action,actor_name_at_event,actor_roles_at_event FROM nazir.audit_events WHERE target_id=$1', [result.id])).rows).toEqual([{ action: 'proposal.create', actor_name_at_event: 'Before', actor_roles_at_event: ['supplier_maintainer'] }]);
});
it.each(['http://api.example.com', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://foo.localhost', 'https://foo.internal', 'https://10.1.2.3', 'https://192.168.0.1', 'https://169.254.169.254', 'https://2130706433', 'https://0x7f000001', 'https://user:pass@api.example.com', 'https://api.example.com/path', 'https://*.example.com'])('refuses adapter host %s', async (host) => {
  const error = await services.registerAdapter(db.driver, members.supplier_maintainer, { agent_id: a.ids.agents, kind: 'http', base_url: host, allowed_hosts: [host], tool_manifest: {} }).catch((error: unknown) => error);
  expect(mapError(error).status).toBe(400);
});
it('refuses a base URL outside the allowed hosts', async () => {
  const error = await services.registerAdapter(db.driver, members.supplier_maintainer, { agent_id: a.ids.agents, kind: 'http', base_url: 'http://api.example.com', allowed_hosts: ['https://api.example.com'], tool_manifest: {} }).catch((error: unknown) => error);
  expect(mapError(error).status).toBe(400);
});
it('returns plain HTTP errors without details', async () => {
  expect(await errorResponse(new Forbidden()).json()).toEqual({ error: { code: 'forbidden', message: 'Your role cannot do this.' } });
  expect(mapError(new NotFound()).status).toBe(404);
  expect(mapError(new Error('secret detail'))).toEqual({ status: 500, body: { error: { code: 'internal_error', message: 'Something went wrong.' } } });
});
it('records one audit event for each successful service operation', async () => {
  const rows = (await db.owner.query<{ action: string; actor_member_id: string; actor_name_at_event: string; actor_roles_at_event: string[] }>("SELECT action,actor_member_id,actor_name_at_event,actor_roles_at_event FROM nazir.audit_events WHERE workspace_id=$1 AND action<>'workspace.created'", [a.workspace_id])).rows;
  for (const action of ['rule_pack.draft', 'rule_pack.approve', 'adapter.write', 'proposal.create', 'proposal.decide', 'finding.override', 'release.decide']) {
    const event = rows.find((row) => row.action === action)!;
    expect(event).toBeDefined(); expect(event.actor_member_id).toBeTruthy(); expect(event.actor_name_at_event).toBeTruthy(); expect(event.actor_roles_at_event.length).toBeGreaterThan(0);
  }
});
it('registers a built in adapter with no network hosts', async () => {
  expect(await services.registerAdapter(db.driver, members.supplier_maintainer, { agent_id: a.ids.agents, kind: 'built_in', base_url: null, allowed_hosts: [], tool_manifest: {} })).toMatchObject({ status: 'draft' });
});
