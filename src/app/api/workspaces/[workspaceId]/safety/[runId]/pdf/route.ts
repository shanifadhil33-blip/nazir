import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute } from '@/server/http/route';
import { linesPdf } from '@/server/reports/pdf';
import { readSafety } from '@/server/safety/read';
import { safetyPdf } from '@/server/safety/pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; runId: string }> }) {
  const { workspaceId, runId } = await context.params;
  const query = new URL(request.url).searchParams.get('lang') ?? 'en';
  return memberRoute(workspaceId, async (memberId) => {
    const lang = z.enum(['en', 'ar']).parse(query);
    const detail = await readSafety(runtimeDriver(), memberId, z.uuid().parse(runId));
    const date = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }).format(new Date(detail.at));
    const fontBytes = await readFile(join(process.cwd(), 'src/server/reports/fonts/NotoSansArabic.ttf'));
    const pdf = await linesPdf({ lang, fontBytes, ...safetyPdf(detail, lang, date) });
    return new Response(new Uint8Array(pdf), { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="nazir-safety-${runId.slice(0, 8)}-${lang}.pdf"`,
    } });
  }, 200, query === 'ar' ? 'ar' : 'en');
}
