import 'server-only';
import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import type { TransactionDriver } from '../db/driver';
import { Coded, type CallerLanguage } from '../http/errors';
import { addKnowledge, knowledgeInput } from './knowledge';

export const PDF_MAX_BYTES = 4 * 1024 * 1024;
export const PDF_TIMEOUT_MS = 10000;
const formLimit = PDF_MAX_BYTES + 32 * 1024;
const metadata = knowledgeInput.omit({ body: true, source_name: true }).extend({ language: z.enum(['en', 'ar']) });
const lines = {
  file: { en: 'Choose a PDF file up to 4 MB.', ar: 'اختر ملف PDF بحجم لا يتجاوز 4 ميغابايت.' },
  unreadable: { en: 'The PDF has no readable text. Upload a PDF with selectable text that is not encrypted.', ar: 'لا يحتوي ملف PDF على نص قابل للقراءة. ارفع ملف PDF غير مشفر يحتوي على نص يمكن تحديده.' },
} as const;

/** Keep the public error code validation while giving PDF failures a specific translated line. */
export class PdfValidation extends Coded {
  constructor(private reason: keyof typeof lines) { super(400, 'validation', lines[reason].en); }
  messageFor(language: CallerLanguage) { return lines[this.reason][language]; }
}

/** Normalize Unicode and whitespace while preserving text order, including Arabic. */
export function normalizePdfText(text: string) {
  return text.normalize('NFKC').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/gu, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractPdfText(bytes: Uint8Array) {
  let document: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const extraction = async () => {
    document = await getDocumentProxy(bytes, { useSystemFonts: false, stopAtErrors: true });
    // Also release a document that finishes loading after the timeout.
    if (expired) { await document.loadingTask.destroy(); throw new PdfValidation('unreadable'); }
    const result = await extractText(document, { mergePages: true });
    const text = normalizePdfText(result.text);
    if (!text) throw new PdfValidation('unreadable');
    return text;
  };
  try {
    return await Promise.race([
      extraction(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new PdfValidation('unreadable')); }, PDF_TIMEOUT_MS); }),
    ]);
  } catch {
    // Password protected, malformed, empty and timed out documents are all validation failures.
    throw new PdfValidation('unreadable');
  } finally {
    clearTimeout(timer);
    if (document) void Promise.resolve().then(() => document?.loadingTask.destroy()).catch(() => {});
  }
}

/** Bound the actual multipart bytes even when Content Length is missing or incorrect. */
export async function readPdfForm(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data') || Number(request.headers.get('content-length')) > formLimit || !request.body) throw new PdfValidation('file');
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > formLimit) { void reader.cancel().catch(() => {}); throw new PdfValidation('file'); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return await new Response(bytes, { headers: { 'content-type': request.headers.get('content-type')! } }).formData();
  } catch {
    throw new PdfValidation('file');
  } finally { reader.releaseLock(); }
}

export async function addKnowledgePdf(driver: TransactionDriver, memberId: string, form: FormData) {
  const file = form.get('file');
  if (!(file instanceof File) || file.type !== 'application/pdf' || file.size > PDF_MAX_BYTES || file.size < 4) throw new PdfValidation('file');
  const fields = Object.fromEntries(form);
  delete fields.file;
  if (!fields.agent_id) delete fields.agent_id;
  const parsed = metadata.safeParse(fields);
  if (!parsed.success) throw new Coded(400, 'validation', 'Check the details and try again.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== '%PDF') throw new PdfValidation('file');
  const body = await extractPdfText(bytes);
  const added = await addKnowledge(driver, memberId, { ...parsed.data, source_name: file.name, body });
  return { ...added, chars: body.length };
}
