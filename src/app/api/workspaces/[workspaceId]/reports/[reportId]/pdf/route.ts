import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute } from '@/server/http/route';
import { buildReportPdf } from '@/server/reports/pdf';
import { readPdfReport } from '@/server/reports/read-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; reportId: string }> }) {
  const { workspaceId, reportId } = await context.params;
  const query = new URL(request.url).searchParams.get('lang') ?? 'en';
  return memberRoute(workspaceId, async (memberId) => {
    const lang = z.enum(['en', 'ar']).parse(query);
    const { body, extras } = await readPdfReport(runtimeDriver(), memberId, reportId, lang);
    const fontBytes = await readFile(join(process.cwd(), 'src/server/reports/fonts/NotoSansArabic.ttf'));
    const pdf = await buildReportPdf(body, { ...extras, fontBytes });
    return new Response(new Uint8Array(pdf), { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="nazir-report-${reportId.slice(0, 8)}-${lang}.pdf"`,
    } });
  }, 200, query === 'ar' ? 'ar' : 'en');
}
