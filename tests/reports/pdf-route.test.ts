import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
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
    expect((await response.json()).error.message).toBe('دورك لا يسمح بهذا.');
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
