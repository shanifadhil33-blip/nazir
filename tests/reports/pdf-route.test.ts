import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
import { readPdfReport } from '../../src/server/reports/read-pdf';
import { createReport } from '../../src/server/reports/read';
import { GET } from '../../src/app/api/workspaces/[workspaceId]/reports/[reportId]/pdf/route';

const session = vi.hoisted(() => ({ memberId: '', driver: undefined as unknown }));
vi.mock('../../src/server/auth/session', () => ({ requireMember: async () => ({ memberId: session.memberId }) }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: () => session.driver }));

let db: TestDatabase;
let owner: string, reviewer: string, viewer: string, supplier: string, outsider: string, workspaceId: string, reportId: string;
beforeAll(async () => {
  db = await testDatabase();
  const seeded = await seed(db, 'ClientPdf');
  owner = seeded.member_id; workspaceId = seeded.workspace_id;
  reviewer = await db.createMember(workspaceId, ['quality_reviewer'], 'PDF Reviewer');
  viewer = await db.createMember(workspaceId, ['viewer'], 'PDF Viewer');
  supplier = await db.createMember(workspaceId, ['supplier_maintainer'], 'PDF Supplier');
  outsider = (await seed(db, 'OtherClientPdf')).member_id;
  session.driver = db.driver;
  const { cancelRunAsMember } = await import('../../src/server/runner/cancel');
  await cancelRunAsMember(db.driver, owner, seeded.ids.runs);
  reportId = (await createReport(db.driver, owner, { run_id: seeded.ids.runs })).id;
}, 60000);
afterAll(async () => { await db?.close(); });

function download(member: string, lang = 'en') {
  session.memberId = member;
  return GET(new Request(`https://example.test/pdf?lang=${lang}`), { params: Promise.resolve({ workspaceId, reportId }) });
}

it('downloads an attachment for owners and reviewers in either language', async () => {
  for (const member of [owner, reviewer]) for (const lang of ['en', 'ar']) {
    const response = await download(member, lang);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="nazir-report-${reportId.slice(0, 8)}-${lang}.pdf"`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  }
});

it('refuses viewers and suppliers with 403 even though they can read a limited report', async () => {
  for (const member of [viewer, supplier]) {
    const response = await download(member, 'ar');
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).error.message).toBe('لا يمكنك فعل هذا.');
  }
});

it('returns 404 when a member requests a report belonging to another workspace', async () => {
  const response = await download(outsider);
  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('validates the requested language', async () => {
  expect((await download(owner, 'fr')).status).toBe(400);
});

it.each(['en', 'ar'] as const)('uses localized saved test goals and labels Dubai time in %s PDF context', async (lang) => {
  const goal = { en: 'Explain the permit fee', ar: 'شرح رسوم التصريح' };
  const scenario = (await db.owner.query<{ id: string; expected_state: unknown; run_id: string }>(
    'SELECT s.id,s.expected_state,c.run_id FROM nazir.scenarios s JOIN nazir.conversations c ON c.scenario_id=s.id WHERE s.workspace_id=$1 LIMIT 1', [workspaceId])).rows[0]!;
  await db.owner.query('UPDATE nazir.scenarios SET expected_state=$1::jsonb WHERE id=$2', [JSON.stringify({ assessment: { goal } }), scenario.id]);
  try {
    const { body, extras } = await readPdfReport(db.driver, owner, reportId, lang);
    expect(extras.testNames?.[body.conversations[0]!.id]).toBe(goal[lang]);
    expect(extras.runDate).toContain(lang === 'ar' ? 'بتوقيت دبي' : 'Dubai time');
  } finally {
    await db.owner.query('UPDATE nazir.scenarios SET expected_state=$1::jsonb WHERE id=$2', [JSON.stringify(scenario.expected_state), scenario.id]);
  }
});
