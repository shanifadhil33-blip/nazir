import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { auditCanonical, readAuditChain, verifyAuditChain } from '../../src/server/audit/verify';
import { testDatabase, type TestDatabase } from '../helpers/pglite';

let db: TestDatabase;
let a: Awaited<ReturnType<TestDatabase['bootstrap']>>;
beforeAll(async () => { db = await testDatabase(); a = await db.bootstrap('Audit'); });
afterAll(async () => { await db?.close(); });
it('records member and worker actors and preserves names and roles at event time', async () => {
  await db.member(a.member_id, (sql) => sql.query("SELECT nazir.append_audit('reviewed','plan',null,'{\"رسالة\":{\"nested\":[1,null,true]}}')"));
  await db.worker(a.workspace_id, (sql) => sql.query("SELECT nazir.append_audit('run.started','run','1','{}')"));
  await db.owner.query("UPDATE nazir.members SET display_name='New name' WHERE id=$1", [a.member_id]);
  await db.owner.query("INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES($1,$2,'viewer')", [a.workspace_id, a.member_id]);
  const rows = await db.member(a.member_id, (sql) => readAuditChain(sql, a.workspace_id));
  expect(rows[1]).toMatchObject({ actor_type: 'member', actor_name_at_event: 'Audit', actor_roles_at_event: ['service_owner'] });
  expect(rows[2]).toMatchObject({ actor_type: 'nazir', actor_member_id: null, actor_roles_at_event: [] });
  expect(verifyAuditChain(rows)).toEqual({ ok: true, count: 3 });
});
it('matches SQL canonical text and UTF8 digest with Arabic, nulls and nested JSON', async () => {
  const rows = await readAuditChain(db.owner, a.workspace_id);
  for (const row of rows) {
    const sql = (await db.owner.query<{ canonical: string }>('SELECT nazir.audit_canonical(e) AS canonical FROM nazir.audit_events e WHERE workspace_id=$1 AND seq=$2', [a.workspace_id, row.seq])).rows[0]!;
    expect(auditCanonical(row)).toBe(sql.canonical);
    expect(createHash('sha256').update(sql.canonical).digest('hex')).toBe(row.hash);
    expect(row.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
  }
});
it('denies direct inserts to both app roles', async () => {
  for (const work of [db.member.bind(null, a.member_id), db.worker.bind(null, a.workspace_id)]) {
    await expect(work((sql) => sql.query("INSERT INTO nazir.audit_events(workspace_id,actor_type,action) VALUES($1,'system','forged')", [a.workspace_id]))).rejects.toThrow(/permission denied/);
  }
});
it('rejects UPDATE, DELETE and TRUNCATE even for the owner', async () => {
  for (const command of ["UPDATE nazir.audit_events SET action='bad'", 'DELETE FROM nazir.audit_events', 'TRUNCATE nazir.audit_events']) {
    await expect(db.owner.query(command)).rejects.toThrow('Append only record');
  }
});
it('detects payload tampering at its sequence', async () => {
  const x = await db.bootstrap('Tamper');
  await db.worker(x.workspace_id, (sql) => sql.query("SELECT nazir.append_audit('second',null,null,'{}')"));
  await db.owner.query('ALTER TABLE nazir.audit_events DISABLE TRIGGER append_only');
  try {
    await db.owner.query("UPDATE nazir.audit_events SET payload='{\"tampered\":true}' WHERE workspace_id=$1 AND seq=2", [x.workspace_id]);
  } finally { await db.owner.query('ALTER TABLE nazir.audit_events ENABLE TRIGGER append_only'); }
  expect(verifyAuditChain(await readAuditChain(db.owner, x.workspace_id))).toEqual({ ok: false, brokenAt: '2', reason: 'hash_mismatch' });
});
it('detects a deleted middle row as a sequence gap', async () => {
  const x = await db.bootstrap('Gap');
  for (let i = 0; i < 2; i++) await db.worker(x.workspace_id, (sql) => sql.query("SELECT nazir.append_audit('next',null,null,'{}')"));
  await db.owner.query('ALTER TABLE nazir.audit_events DISABLE TRIGGER append_only');
  try { await db.owner.query('DELETE FROM nazir.audit_events WHERE workspace_id=$1 AND seq=2', [x.workspace_id]); }
  finally { await db.owner.query('ALTER TABLE nazir.audit_events ENABLE TRIGGER append_only'); }
  expect(verifyAuditChain(await readAuditChain(db.owner, x.workspace_id))).toEqual({ ok: false, brokenAt: '3', reason: 'seq_gap' });
});
it('ignores supplied seq, timestamp and hashes', async () => {
  const x = await db.bootstrap('Supplied');
  await db.owner.query("INSERT INTO nazir.audit_events(workspace_id,seq,at,actor_type,action,prev_hash,hash) VALUES($1,99,'2000-01-01','system','test','wrong','wrong')", [x.workspace_id]);
  const rows = await readAuditChain(db.owner, x.workspace_id);
  expect(rows[1]?.seq).toBe('2');
  expect(rows[1]?.at.startsWith('2000')).toBe(false);
  expect(verifyAuditChain(rows)).toEqual({ ok: true, count: 2 });
});
it('keeps independent workspace sequences under concurrent queued transactions', async () => {
  // PGlite serializes transactions on its single connection; live PostgreSQL uses the advisory lock.
  const [x, y] = await Promise.all([db.bootstrap('ParallelX'), db.bootstrap('ParallelY')]);
  await Promise.all(Array.from({ length: 6 }, (_, i) => db.worker(i % 2 ? x.workspace_id : y.workspace_id, (sql) => sql.query("SELECT nazir.append_audit('parallel',null,null,'{}')"))));
  for (const identity of [x, y]) {
    const rows = await readAuditChain(db.owner, identity.workspace_id);
    expect(rows[0]?.seq).toBe('1');
    expect(verifyAuditChain(rows)).toEqual({ ok: true, count: 4 });
  }
});
it('reports prev_link and accepts an empty chain', async () => {
  const rows = await readAuditChain(db.owner, a.workspace_id);
  expect(verifyAuditChain(rows.map((r, i) => i === 1 ? { ...r, prev_hash: 'bad' } : r))).toEqual({ ok: false, brokenAt: '2', reason: 'prev_link' });
  expect(verifyAuditChain([])).toEqual({ ok: true, count: 0 });
});
