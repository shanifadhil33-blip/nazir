import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { demoRulePack } from '@/sandbox/demo-rule-pack';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import { Coded, errorResponse } from '../http/errors';
import { requestLanguage } from '../http/route';

// This stateless sample never opens a tenant, writes data, calls a model or accepts privileged settings.
// Its fixed responses follow the same public service policy as the protected sample agent.
export function sampleReply(message: string, language: 'en' | 'ar') {
  const copy = (language === 'ar' ? ar : en).sampleAgent;
  if (/refund|penalt|legal|immigr|استرداد|غرام|هجر/i.test(message) && demoRulePack.clauses.some((c) => c.id === '5.1')) return copy.limits;
  if (/complaint|شكوى|شكو/i.test(message) && demoRulePack.clauses.some((c) => c.id === '2.1')) return copy.complaint;
  if (/suggest|اقتراح/i.test(message)) return copy.suggestion;
  return copy.intro;
}
export function sampleSkills(language: 'en' | 'ar') {
  const c = (language === 'ar' ? ar : en).sampleAgent;
  return [
    { id: 'complaints', name: c.complaints, description: c.complaint, tags: ['complaints'], examples: [c.complaintExample] },
    { id: 'suggestions', name: c.suggestions, description: c.suggestion, tags: ['suggestions'], examples: [c.suggestionExample] },
    { id: 'information', name: c.information, description: c.intro, tags: ['information'], examples: [c.informationExample] },
  ];
}
const messageInput = z.object({ message: z.string().trim().min(1).max(2000), session_id: z.string().max(200).optional(), language: z.enum(['en', 'ar']).optional() }).strict();
const buckets = new Map<string, { count: number; until: number }>();
let overall = { count: 0, until: 0 };
/** Bounded process limits are sufficient for a stateless sample with no paid or privileged calls. */
export function allowSample(request: Request, now = Date.now()): boolean {
  for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
  if (overall.until <= now) overall = { count: 0, until: now + 60_000 };
  const address = (request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown').split(',')[0]!.trim().slice(0, 100);
  const caller = createHash('sha256').update(address).digest('hex');
  const bucket = buckets.get(caller) ?? { count: 0, until: now + 60_000 };
  if (bucket.count >= 60 || overall.count >= 600 || (!buckets.has(caller) && buckets.size >= 1000)) return false;
  bucket.count++; overall.count++; buckets.set(caller, bucket); return true;
}
export async function publicSample(request: Request, action: 'simple' | 'a2a' | 'card'): Promise<Response> {
  const language = requestLanguage(request);
  try {
    if (!allowSample(request)) throw new Coded(429, 'too_many', '');
    const headers = { 'cache-control': 'no-store' };
    if (action === 'card') {
      // The public service origin is configured by the operator, never supplied by card consumers.
      const configured = new URL(process.env.AUTH_URL ?? request.url).origin;
      const url = new URL('/api/sandbox/agent/a2a', configured).href;
      return Response.json({ name: (language === 'ar' ? ar : en).shell.helpDesk, description: (language === 'ar' ? ar : en).sampleAgent.intro, version: '1.0.0',
        supportedInterfaces: [{ url, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }], capabilities: { streaming: false, pushNotifications: false },
        defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'], skills: sampleSkills(language) }, { headers });
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 10000) throw new Coded(400, 'validation', '');
    let body: unknown; try { body = JSON.parse(raw); } catch { throw new Coded(400, 'validation', ''); }
    if (action === 'simple') {
      const input = messageInput.parse(body);
      return Response.json({ reply: sampleReply(input.message, input.language ?? language) }, { headers });
    }
    const rpc = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string().max(200), z.number()]), method: z.enum(['SendMessage', 'message/send']), params: z.object({
      message: z.object({ kind: z.literal('message').optional(), messageId: z.string().max(200), contextId: z.string().max(200).optional(), role: z.enum(['user', 'ROLE_USER']), parts: z.array(z.object({ kind: z.literal('text').optional(), text: z.string().trim().min(1).max(2000) }).strict()).min(1).max(10) }).strict(),
      configuration: z.object({ acceptedOutputModes: z.array(z.literal('text/plain')).max(1).optional(), returnImmediately: z.boolean().optional(), blocking: z.boolean().optional() }).strict().optional(),
    }).strict() }).strict().parse(body);
    const content = rpc.params.message.parts.map((p) => p.text).join('\n');
    const reply = sampleReply(content, /[\u0600-\u06ff]/.test(content) ? 'ar' : language);
    const message = { messageId: crypto.randomUUID(), role: rpc.method === 'message/send' ? 'agent' : 'ROLE_AGENT', parts: [{ ...(rpc.method === 'message/send' ? { kind: 'text' } : {}), text: reply }] };
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'message/send' ? { kind: 'message', ...message } : { message } }, { headers });
  } catch (error) { const response = errorResponse(error, language); response.headers.set('cache-control', 'no-store'); return response; }
}
