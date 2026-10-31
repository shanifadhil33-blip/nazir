import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { createAuthAdapter } from '../../src/server/auth/adapter';
import { ensureHomeWorkspace } from '../../src/server/auth/workspaces';
import { createReport, listReports } from '../../src/server/reports/read';
import { readPdfReport } from '../../src/server/reports/read-pdf';
import { GET as pdf } from '../../src/app/api/workspaces/[workspaceId]/reports/[reportId]/pdf/route';
import { GET as list } from '../../src/app/api/workspaces/[workspaceId]/reports/route';

// No model, worker or network call: a new home workspace is created through the sign in path and read through the routes.
const session = vi.hoisted(() => ({ memberId: '', driver: undefined as unknown }));
vi.mock('../../src/server/auth/session', () => ({ requireMember: async () => ({ memberId: session.memberId }) }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: () => session.driver }));

let db: TestDatabase;
let workspaceId: string, owner: string, reviewer: string, viewer: string;
beforeAll(async () => {
  db = await testDatabase();
  session.driver = db.driver;
  const user = await createAuthAdapter(() => db.driver).createUser!({ id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: 'Saeed', image: null, emailVerified: null });
  workspaceId = await ensureHomeWorkspace(db.driver, user.id);
  owner = (await db.owner.query<{ id: string }>('SELECT id FROM nazir.members WHERE workspace_id=$1', [workspaceId])).rows[0]!.id;
  reviewer = await db.createMember(workspaceId, ['quality_reviewer'], 'Khalid Hamdan');
  viewer = await db.createMember(workspaceId, ['viewer'], 'Hamad Saleh');
}, 60000);
afterAll(async () => { await db?.close(); });

const params = (reportId: string) => ({ params: Promise.resolve({ workspaceId, reportId }) });
function download(member: string, reportId: string, lang: string) {
  session.memberId = member;
  return pdf(new Request(`https://example.test/pdf?lang=${lang}`), params(reportId));
}
function reports(member: string, lang: string) {
  session.memberId = member;
  return list(new Request('https://example.test/reports', { headers: { 'accept-language': lang } }), { params: Promise.resolve({ workspaceId }) });
}
const firstReport = { en: 'Run a Quick check to get your first report.', ar: 'شغل فحصا سريعا لتحصل على تقريرك الأول.' };

it.each(['en', 'ar'] as const)('lists no reports and no runs for every role in a new workspace (%s)', async (lang) => {
  for (const member of [owner, reviewer, viewer]) {
    const response = await reports(member, lang);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reports: [], runs: 0 });
  }
});

it.each(['en', 'ar'] as const)('answers the PDF route on an empty workspace with the first report message, not an error (%s)', async (lang) => {
  for (const member of [owner, reviewer]) for (const id of [crypto.randomUUID(), 'latest']) {
    const response = await download(member, id, lang);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: { code: 'no_report', message: firstReport[lang] } });
  }
  // The role check still comes first.
  const refused = await download(viewer, crypto.randomUUID(), lang);
  expect(refused.status).toBe(403);
});

it('reads one run as a report and a PDF in English and Arabic, with no before run', async () => {
  const agentVersion = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.agent_versions WHERE workspace_id=$1 AND config->>'registry_id'='baseline'", [workspaceId])).rows[0]!.id;
  const pack = (await db.owner.query<{ id: string }>("INSERT INTO nazir.rule_packs(workspace_id,key,title) VALUES($1,'first','Fictional rules') RETURNING id", [workspaceId])).rows[0]!.id;
  const rules = (await db.owner.query<{ id: string }>("INSERT INTO nazir.rule_pack_versions(workspace_id,rule_pack_id,version,content) VALUES($1,$2,1,'{}') RETURNING id", [workspaceId, pack])).rows[0]!.id;
  const plan = (await db.owner.query<{ id: string }>("INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,proposed_by_type,proposed_by) VALUES($1,'first',$2,$3,'{test}','{en,ar}',1,10,'{}','member',$4) RETURNING id", [workspaceId, agentVersion, rules, owner])).rows[0]!.id;
  const run = (await db.owner.query<{ id: string }>("INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,finished_at) VALUES($1,$2,$3,$4,'{\"size\":\"quick\",\"testCount\":16}','1','passed',now()) RETURNING id", [workspaceId, plan, agentVersion, rules])).rows[0]!.id;
  const report = await createReport(db.driver, owner, { run_id: run });

  for (const lang of ['en', 'ar'] as const) {
    const listed = await (await reports(viewer, lang)).json();
    expect(listed.runs).toBe(1);
    expect(listed.reports.map((r: { id: string }) => r.id)).toEqual([report.id]);
    const response = await download(owner, report.id, lang);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="nazir-report-${report.id.slice(0, 8)}-${lang}.pdf"`);
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const { body, extras } = await readPdfReport(db.driver, reviewer, report.id, lang);
    expect(body.run.id).toBe(run);
    expect(extras.before).toBeNull();
    expect(extras.agentName).toBe('Fictional Service Agent');
  }
  expect((await listReports(db.driver, owner)).runs).toBe(1);
});
