import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { sandboxIdentifier, withWorker } from '@/server/db/context';
import { runtimeDriver } from '@/server/db/runtime';
import { errorResponse, messageFor } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
import { runServiceAgent } from '@/sandbox/agent';
import { createAgentModel } from '@/sandbox/model-factory';
import { getAgentVersion } from '@/sandbox/versions';
const bodySchema = z.strictObject({
  version: z.string().default('baseline'),
  tenant: z.string().regex(sandboxIdentifier), requester_key: z.string().regex(sandboxIdentifier), conversation_key: z.string().min(1).max(200),
  messages: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(2000) })).min(1).max(20),
});
export async function POST(request: Request): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' };
  const language = requestLanguage(request);
  const token = process.env.SANDBOX_AGENT_TOKEN;
  if (!token) return Response.json({ error: messageFor('not_found', language) }, { status: 404, headers });
  const supplied = request.headers.get('authorization') ?? '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(supplied), digest(`Bearer ${token}`))) return Response.json({ error: messageFor('unauthorized', language) }, { status: 401, headers });
  try {
    let raw: unknown;
    try { raw = await request.json(); } catch { raw = null; }
    const input = bodySchema.parse(raw);
    const version = getAgentVersion(input.version);
    if (!version) return Response.json({ error: messageFor('unknown_version', language) }, { status: 400, headers });
    const driver = runtimeDriver();
    await withWorker(driver, '00000000-0000-0000-0000-000000000000', (db) => db.query('SELECT sandbox.seed_tenant($1)', [input.tenant]));
    const result = await runServiceAgent({ model: createAgentModel(), version, messages: input.messages, sandbox: { driver, tenant: input.tenant, requesterKey: input.requester_key }, conversationKey: input.conversation_key });
    return Response.json({ reply: result.reply, tool_calls: result.toolCalls, version: { id: version.id, label: version.label, kind: version.kind, disclosure: version.disclosure } }, { headers });
  } catch (error) {
    const response = errorResponse(error, language);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
