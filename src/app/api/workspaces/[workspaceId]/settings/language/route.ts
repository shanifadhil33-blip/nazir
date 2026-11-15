import { requireMember } from '@/server/auth/session';
import { runtimeDriver } from '@/server/db/runtime';
import { Coded, errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
import { setMyLanguage } from '@/server/settings/language';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
/** Language, saved for you only. Demo visitors share one sample person, so their choice lives in the address only. */
export async function PUT(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const member = await requireMember((await context.params).workspaceId);
    const text = await request.text();
    if (text.length > 200) throw new Coded(400, 'validation', 'Check the details and try again.');
    let body: { language?: unknown } = {};
    try { body = JSON.parse(text); } catch { throw new Coded(400, 'validation', 'Check the details and try again.'); }
    const result = member.kind === 'demo' ? { language: z.enum(['en', 'ar']).parse(body.language) } : await setMyLanguage(runtimeDriver(), member.memberId, body.language);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const response = errorResponse(error, requestLanguage(request));
    response.headers.set('cache-control', 'no-store');
    return response;
  }
}
