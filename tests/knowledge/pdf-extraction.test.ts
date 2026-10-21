import { afterEach, expect, it, vi } from 'vitest';
import type { TransactionDriver } from '../../src/server/db/driver';
import { addKnowledgePdf, extractPdfText, normalizePdfText, PDF_TIMEOUT_MS } from '../../src/server/knowledge/pdf';

const parser = vi.hoisted(() => ({ open: vi.fn(), text: vi.fn() }));
vi.mock('unpdf', () => ({ getDocumentProxy: parser.open, extractText: parser.text }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it('normalizes Arabic without reversing letters or removing glyphs', () => {
  // Helvetica in the hand made PDF fixture has no Arabic glyph map. Test the extraction normalizer directly.
  const arabic = 'سياسة تجديد الرخصة التجارية';
  expect(normalizePdfText(` \tسياسة  تجديد\u00a0الرخصة\tالتجارية\r\n\r\n\r\nرسوم  التجديد\u0000 `)).toBe(`${arabic}\n\nرسوم التجديد`);
});

it('times out extraction, releases the PDF and allows the next extraction to succeed', async () => {
  vi.useFakeTimers();
  const destroy = vi.fn().mockResolvedValue(undefined);
  parser.open.mockResolvedValue({ loadingTask: { destroy } });
  parser.text.mockImplementationOnce(() => new Promise(() => {}));
  const pending = extractPdfText(new Uint8Array());
  const refused = expect(pending).rejects.toMatchObject({ status: 400, code: 'validation' });
  await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS);
  await refused;
  expect(destroy).toHaveBeenCalledOnce();
  parser.text.mockResolvedValueOnce({ text: ' Next   document ', totalPages: 1 });
  expect(await extractPdfText(new Uint8Array())).toBe('Next document');
  expect(destroy).toHaveBeenCalledTimes(2);
});

it('releases a PDF that finishes loading after the timeout', async () => {
  vi.useFakeTimers();
  const destroy = vi.fn().mockResolvedValue(undefined);
  let resolve!: (value: { loadingTask: { destroy: typeof destroy } }) => void;
  parser.open.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const pending = extractPdfText(new Uint8Array());
  const refused = expect(pending).rejects.toMatchObject({ status: 400, code: 'validation' });
  await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS);
  await refused;
  resolve({ loadingTask: { destroy } });
  await vi.advanceTimersByTimeAsync(0);
  expect(destroy).toHaveBeenCalledOnce();
  expect(parser.text).not.toHaveBeenCalled();
});

it.each([
  ['body length', 'x'.repeat(200001)],
  ['chunk count', Array(301).fill('x'.repeat(500)).join('\n\n')],
])('applies the existing %s limit before attempting to store extracted text', async (_limit, text) => {
  parser.open.mockResolvedValue({ loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) } });
  parser.text.mockResolvedValue({ text, totalPages: 1 });
  const form = new FormData();
  form.set('file', new File(['%PDF-test'], 'many.pdf', { type: 'application/pdf' }));
  form.set('pack', 'government'); form.set('kind', 'policy'); form.set('language', 'en'); form.set('title', 'Too many chunks');
  const driver = { transaction: vi.fn() };
  await expect(addKnowledgePdf(driver as unknown as TransactionDriver, 'owner', form)).rejects.toMatchObject({ status: 400, code: 'validation' });
  expect(driver.transaction).not.toHaveBeenCalled();
});
