import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { readHistory } from '@/server/shell/history';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => {
    const before = z.string().regex(/^\d{1,18}$/).nullable().parse(new URL(request.url).searchParams.get('before'));
    return readHistory(runtimeDriver(), memberId, 50, before);
  }, 200, requestLanguage(request));
}
