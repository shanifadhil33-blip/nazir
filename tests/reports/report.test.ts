import { existsSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
import { Forbidden, NotFound, mapError } from '../../src/server/http/errors';
import * as build from '../../src/server/reports/build';
import { assembleReport, projectReport, scopeLine, type ReportBody } from '../../src/server/reports/build';
import * as reports from '../../src/server/reports/read';
import { createReport, listReports, readFullReport } from '../../src/server/reports/read';

const sample = (): ReportBody => assembleReport({
  run: { id: 'run', status: 'failed', calls_used: 2, calls_budget: 8 },
  conversations: [{ id: 'c1', status: 'failed', split: 'development', language: 'en' }, { id: 'c2', status: 'passed', split: 'hidden', language: 'ar' }],
  findings: [
    { id: 'f1', check_id: 'right_queue', severity: 'high', title: 'Wrong queue', title_ar: 'طابور غير صحيح', really_happened: 'The case is in the wrong queue.', really_happened_ar: 'القضية في الطابور غير الصحيح.', split: 'development', family: 'wrong_routing_queue', language: 'en', agent_said: 'SAEED-SAID-DEV', evidence: { quote: 'SAEED-SAID-DEV' } },
    { id: 'f2', check_id: 'ownership', severity: 'critical', title: 'Hidden case', title_ar: 'قضية مخفية', really_happened: 'Another requester was named.', really_happened_ar: 'ذُكر صاحب طلب آخر.', split: 'hidden', family: 'broad_case_export', language: 'ar', agent_said: 'IMRAN-SAID-HIDDEN', evidence: { quote: 'IMRAN-SAID-HIDDEN' } },
  ],
  messages: [{ conversation_id: 'c1', seq: 1, speaker: 'agent', body: 'SAEED-SAID-DEV', split: 'development' }, { conversation_id: 'c2', seq: 1, speaker: 'agent', body: 'IMRAN-SAID-HIDDEN', split: 'hidden' }],
});

it('builds both languages from the same counts and keeps quotes on the development copy', () => {
  const full = sample();
  const supplier = projectReport(full, 'development');
  expect(full.scope).toEqual(scopeLine);
  expect(full.sentences.en[0]).toContain('within tested scope, not a certificate');
  expect(full.sentences.ar[0]).toContain('ضمن النطاق المختبر');
  expect(full.sentences.en.join(' ')).toContain('1 of 2');
  expect(full.sentences.ar.join(' ')).toContain('1 من 2');
  expect(projectReport(full, 'full').findings).toHaveLength(2);
  expect(supplier.findings.map((finding) => finding.id)).toEqual(['f1']);
  expect(supplier.findings[0]?.agent_said).toBe('SAEED-SAID-DEV');
  expect(supplier.hidden_findings).toBe(full.hidden_findings);
  expect(JSON.stringify(supplier)).not.toContain('IMRAN-SAID-HIDDEN');
  expect('reportHtml' in build).toBe(false);
  expect('escapeHtml' in build).toBe(false);
  expect('readViewerReport' in reports).toBe(false);
  expect('readReportHtml' in reports).toBe(false);
});

it('answers 404 for the removed print and redacted viewer routes', () => {
  const statusFor = (file: string) => existsSync(file) ? 200 : 404;
  const root = 'src/app/api/workspaces/[workspaceId]/reports/[reportId]';
  expect(statusFor(`${root}/route.ts`)).toBe(200);
  expect(statusFor(`${root}/print/route.ts`)).toBe(404);
  expect(statusFor(`${root}/viewer/route.ts`)).toBe(404);
  expect(statusFor(`${root}/viewer/print/route.ts`)).toBe(404);
});

let db: TestDatabase;
let owner: string;
let reviewer: string;
let supplier: string;
let viewer: string;
let runId: string;
beforeAll(async () => {
  db = await testDatabase();
  const seeded = await seed(db, 'Report');
  owner = seeded.member_id;
  runId = seeded.ids.runs!;
  reviewer = await db.createMember(seeded.workspace_id, ['quality_reviewer'], 'Khalid Hamdan');
  supplier = await db.createMember(seeded.workspace_id, ['supplier_maintainer'], 'Yusuf Rahman');
  viewer = await db.createMember(seeded.workspace_id, ['viewer'], 'Hamza Nasser');
  const hidden = (await db.owner.query<{ id: string }>(`INSERT INTO nazir.scenarios(workspace_id,meaning_id,stable_key,version,family,language,split,persona,starting_state,allowed_actions,forbidden_actions,expected_state,source_clause,expectation_kind,severity,rubric_version,status)
    VALUES($1,$2,'hidden_case',1,'broad_case_export','ar','hidden','{}','{}','{}','{}','{}','fictional','fictional_demo_rule','critical','1','approved') RETURNING id`, [seeded.workspace_id, seeded.ids.scenario_meanings])).rows[0]!.id;
  const conversation = (await db.owner.query<{ id: string }>("INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key,status) VALUES($1,$2,$3,'ar','hidden','failed') RETURNING id", [seeded.workspace_id, runId, hidden])).rows[0]!.id;
  await db.owner.query(`INSERT INTO nazir.findings(workspace_id,run_id,conversation_id,scenario_id,check_layer,check_id,title,title_ar,agent_said,really_happened,really_happened_ar,rule_pack_version_id,rule_clause,agent_version_id,severity,root_cause_class,owner_role,evidence,language)
    VALUES($1,$2,$3,$4,'record','right_queue','Wrong queue','نتيجة','SAEED-SAID-DEV','The case is in the wrong queue.','حدث مسجل',$5,'1',$6,'high','workflow_failure','quality_reviewer','{}','en')`,
  [seeded.workspace_id, runId, seeded.ids.conversations, seeded.ids.scenarios, seeded.ids.rule_pack_versions, seeded.ids.agent_versions]);
  await db.owner.query(`INSERT INTO nazir.findings(workspace_id,run_id,conversation_id,scenario_id,check_layer,check_id,title,title_ar,agent_said,really_happened,really_happened_ar,rule_pack_version_id,rule_clause,agent_version_id,severity,root_cause_class,owner_role,evidence,language)
    VALUES($1,$2,$3,$4,'record','ownership','Hidden case','قضية مخفية','IMRAN-SAID-HIDDEN','Another requester was named.','ذُكر صاحب طلب آخر',$5,'1',$6,'critical','missing_authorization','quality_reviewer','{}','ar')`,
  [seeded.workspace_id, runId, conversation, hidden, seeded.ids.rule_pack_versions, seeded.ids.agent_versions]);
}, 60000);
afterAll(async () => { await db?.close(); });

it('gives a viewer the normal report and still refuses a viewer write', async () => {
  const created = await createReport(db.driver, owner, { run_id: runId });
  expect(created.scope.en).toContain('within tested scope, not a certificate');
  const full = await readFullReport(db.driver, reviewer, created.id);
  const safe = await readFullReport(db.driver, supplier, created.id);
  const asViewer = await readFullReport(db.driver, viewer, created.id);
  expect(asViewer.scope).toEqual(full.scope);
  expect(asViewer.run.id).toBe(full.run.id);
  expect(JSON.stringify(full)).toContain('SAEED-SAID-DEV');
  expect(JSON.stringify(full)).toContain('IMRAN-SAID-HIDDEN');
  expect(JSON.stringify(asViewer)).toContain('SAEED-SAID-DEV');
  expect(JSON.stringify(asViewer)).not.toContain('IMRAN-SAID-HIDDEN');
  expect(asViewer.findings.map((finding) => finding.id).sort()).toEqual(safe.findings.map((finding) => finding.id).sort());
  expect(asViewer.messages.length).toBeGreaterThan(0);
  expect(JSON.stringify(safe)).toContain('SAEED-SAID-DEV');
  expect(JSON.stringify(safe)).not.toContain('IMRAN-SAID-HIDDEN');
  expect((await listReports(db.driver, owner)).reports.some((row) => row.id === created.id)).toBe(true);
  const viewerList = await listReports(db.driver, viewer);
  expect(viewerList.reports.some((row) => row.id === created.id)).toBe(true);
  expect(JSON.stringify(viewerList)).not.toContain('IMRAN-SAID-HIDDEN');
  expect(JSON.stringify(await listReports(db.driver, supplier))).not.toContain('IMRAN-SAID-HIDDEN');
  let refusal: unknown;
  try {
    await createReport(db.driver, viewer, { run_id: runId });
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(Forbidden);
  expect(mapError(refusal).status).toBe(403);
  expect(mapError(refusal, 'ar').body.error.message).toBe('دورك لا يسمح بهذا.');
  const other = await db.bootstrap('OtherReport');
  await expect(readFullReport(db.driver, other.member_id, created.id)).rejects.toBeInstanceOf(NotFound);
  expect((await db.member(viewer, (sql) => sql.query('SELECT id FROM nazir.reports'))).rows).toHaveLength(0);
  await expect(db.member(viewer, (sql) => sql.query('SELECT nazir.read_report($1)', [created.id]))).rejects.toThrow(/cannot do this/);
  expect((await db.owner.query("SELECT action FROM nazir.audit_events WHERE action='report.created' AND target_id=$1", [created.id])).rows).toHaveLength(1);
});
