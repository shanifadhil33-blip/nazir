import { runtimeDriver } from '@/server/db/runtime';
import { Coded } from '@/server/http/errors';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { readAgentSettings, saveAgentSettings } from '@/server/settings/agent-settings';
import { installPack } from '@/server/packs/install';
import { runtimeForPack } from '@/server/packs/runtime';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => readAgentSettings(runtimeDriver(), memberId), 200, requestLanguage(request));
}
export async function PUT(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const text = await request.text();
  return memberRoute(workspaceId, (memberId) => {
    if (text.length > 400000) throw new Coded(400, 'validation', 'Check the details and try again.');
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new Coded(400, 'validation', 'Check the details and try again.'); }
    return saveAgentSettings(runtimeDriver(), memberId, body).then(async (saved) => {
      // Picking a live pack with its own sandbox adds its demo agent and its 48 cases as drafts for a reviewer to approve.
      const pack = body && typeof body === 'object' ? (body as { focus_pack?: unknown }).focus_pack : undefined;
      if (typeof pack === 'string' && runtimeForPack(pack)) await installPack(runtimeDriver(), memberId, pack).catch(() => null);
      return saved;
    });
  }, 200, requestLanguage(request));
}
