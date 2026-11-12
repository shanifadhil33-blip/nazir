import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
import { POST } from '../../src/app/api/workspaces/[workspaceId]/knowledge/pdf/route';
import { listKnowledge, searchKnowledge } from '../../src/server/knowledge/knowledge';
import { PDF_MAX_BYTES } from '../../src/server/knowledge/pdf';

const session = vi.hoisted(() => ({ memberId: '', driver: undefined as unknown }));
vi.mock('../../src/server/auth/session', () => ({ requireMember: async () => ({ memberId: session.memberId }) }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: () => session.driver }));

let db: TestDatabase;
let owner: string;
let reviewer: string;
let viewer: string;
let outsider: string;
let workspaceId: string;
beforeAll(async () => {
  db = await testDatabase();
  const seeded = await seed(db, 'PdfKnowledge');
  owner = seeded.member_id; workspaceId = seeded.workspace_id;
  reviewer = await db.createMember(workspaceId, ['quality_reviewer'], 'PDF Reviewer');
  viewer = await db.createMember(workspaceId, ['viewer'], 'PDF Viewer');
  outsider = (await seed(db, 'OtherPdfKnowledge')).member_id;
  session.driver = db.driver;
}, 60000);
afterAll(async () => { await db?.close(); });

/** A real one page PDF with byte accurate stream lengths and cross reference offsets. */
function pdf(text = '', encrypted = false) {
  const content = text ? `BT /F1 12 Tf 72 720 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET\n` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  if (encrypted) objects.push(`<< /Filter /Standard /V 1 /R 2 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> /P -4 >>`);
  let result = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  result += `trailer\n<< /Size ${offsets.length} /Root 1 0 R${encrypted ? ' /Encrypt 6 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]' : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([result], 'permit.pdf', { type: 'application/pdf' });
}

function form(file: File) {
  const data = new FormData();
  data.set('file', file); data.set('pack', 'government'); data.set('kind', 'policy');
  data.set('language', 'en'); data.set('title', 'Quartz permit policy');
  return data;
}

async function upload(data: FormData, memberId = owner, language = 'en') {
  session.memberId = memberId;
  return POST(new Request('http://localhost/api/knowledge/pdf', { method: 'POST', headers: { 'accept-language': language }, body: data }), { params: Promise.resolve({ workspaceId }) });
}

it('uploads extracted text through the owner rule and keeps stored knowledge searchable and isolated', async () => {
  const response = await upload(form(pdf('Quartz permit processing takes five days.')));
  expect(response.status).toBe(201);
  const added = await response.json();
  expect(added).toMatchObject({ chunks: 1, chars: 41 });
  const doc = (await listKnowledge(db.driver, owner)).docs.find((d) => d.id === added.id);
  expect(doc).toMatchObject({ title: 'Quartz permit policy', source_name: 'permit.pdf', chars: 41, chunks: 1 });
  expect((await searchKnowledge(db.driver, viewer, 'quartz'))[0]).toMatchObject({ doc_id: added.id, excerpt: 'Quartz permit processing takes five days.' });
  expect(await searchKnowledge(db.driver, outsider, 'quartz')).toEqual([]);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('refuses reviewer and viewer uploads using the existing owner only rule', async () => {
  for (const memberId of [reviewer, viewer]) {
    const response = await upload(form(pdf('Only owners can add this document.')), memberId, 'ar');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'forbidden', message: 'لا يمكنك فعل هذا.' } });
  }
});

it('rejects files over 4 MB, non PDF bytes and incorrect MIME types', async () => {
  for (const file of [
    new File([new Uint8Array(PDF_MAX_BYTES + 1)], 'large.pdf', { type: 'application/pdf' }),
    new File(['This is plain text.'], 'fake.pdf', { type: 'application/pdf' }),
    new File([await pdf('Text').arrayBuffer()], 'wrong.pdf', { type: 'text/plain' }),
  ]) {
    const response = await upload(form(file));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'validation', message: 'Choose a PDF file up to 4 MB.' } });
  }
});

it('returns a clear translated validation error for empty, encrypted and broken PDFs', async () => {
  for (const language of ['en', 'ar']) for (const file of [pdf(), pdf('Secret', true), new File(['%PDF-1.4\nbroken'], 'broken.pdf', { type: 'application/pdf' })]) {
    const response = await upload(form(file), owner, language);
    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error.code).toBe('validation');
    expect(error.message).toContain(language === 'ar' ? 'لا يحتوي ملف PDF على نص قابل للقراءة' : 'The PDF has no readable text');
  }
});

it('keeps metadata validation in force', async () => {
  for (const [key, value] of [['language', 'mixed'], ['pack', 'unknown_pack'], ['kind', 'unknown'], ['title', ''], ['agent_id', 'invalid']]) {
    const data = form(pdf('Readable text.')); data.set(key!, value!);
    const response = await upload(data);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('validation');
  }
});

it('rejects malformed multipart data and bounds bodies without trusting Content Length', async () => {
  session.memberId = owner;
  for (const request of [
    new Request('http://localhost/pdf', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=missing' }, body: 'broken' }),
    new Request('http://localhost/pdf', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=large' }, body: new Uint8Array(PDF_MAX_BYTES + 32769) }),
  ]) {
    const response = await POST(request, { params: Promise.resolve({ workspaceId }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('validation');
  }
});

