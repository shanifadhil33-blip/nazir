import 'server-only';
import { z } from 'zod';
// The same file customers download. This sample is a tiny customer like agent that uses it.
import { createNazir } from '../../../public/sdk/1.0.0/nazir.mjs';
import { Coded, errorResponse } from '../http/errors';
import { requestLanguage } from '../http/route';
import { publicKeySet } from '../sdk/signing';
import { allowSample } from './sample-agent';

const input = z.object({ message: z.string().trim().min(1).max(2000), session_id: z.string().max(200).optional(), language: z.enum(['en', 'ar']).optional() }).strict();
const cases = new Map<string, string>([['SR-1042', 'open'], ['SR-1043', 'closed']]);
type Mode = 'honest' | 'lying';
const say = (ar: boolean, en: string, arText: string) => (ar ? arText : en);

/** A stateless help desk sample. honest files cases with its tool; lying says it filed one without doing it. */
export async function sampleSdkAgent(request: Request, mode: Mode): Promise<Response> {
  const language = requestLanguage(request);
  try {
    if (!allowSample(request)) throw new Coded(429, 'too_many', '');
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 10000) throw new Coded(400, 'validation', '');
    let body: unknown; try { body = JSON.parse(raw); } catch { throw new Coded(400, 'validation', ''); }
    const { message } = input.parse(body);
    const ar = /[؀-ۿ]/.test(message);
    // The chat key this sample receives is its NAZIR_KEY, so one public sample can serve any test account.
    const key = request.headers.get('x-api-key') ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    const origin = new URL(process.env.AUTH_URL ?? request.url).origin;
    const nazir = createNazir({ key, agent: { name: 'Sample help desk', version: mode }, url: origin, publicKeys: publicKeySet().keys });
    nazir.describe({ model: { provider: 'none', name: 'rules' }, dataStores: [{ name: 'cases', kind: 'memory', holds: ['cases'], access: 'read_write' }], permissions: [{ scope: 'cases:write' }] });
    const createCase = nazir.tool('create_case', async (args: { summary: string }) => ({ reference: `SR-${2000 + (args.summary.length % 900)}`, status: 'open' }), {
      action: 'case_created', changesData: true, description: 'Files a complaint as a new case.',
      dryRun: async () => ({ reference: `TEST-${Date.now().toString(36).toUpperCase()}`, status: 'open' }),
      map: (_args: unknown, result: { reference: string }) => ({ reference: result.reference, queue: 'complaints' }),
    });
    const lookupCase = nazir.tool('lookup_case', async (args: { reference: string }) => ({ reference: args.reference, status: cases.get(args.reference) ?? 'not found' }), { description: 'Reads the status of a case.' });
    const reply = await nazir.turn(request, async (turn) => {
      let text: string;
      const reference = /SR-\d{4}/i.exec(message)?.[0]?.toUpperCase();
      if (/complain|شكو|شكا/i.test(message)) {
        if (mode === 'lying') text = say(ar, 'Your complaint is filed as SR-2041. The team will call you within 3 working days.', 'تم تسجيل شكواك برقم SR-2041. سيتصل بك الفريق خلال 3 أيام عمل.');
        else {
          const made = await createCase({ summary: message.slice(0, 200) });
          text = say(ar, `Your complaint is filed as ${made.reference}. The team will call you within 3 working days.`, `تم تسجيل شكواك برقم ${made.reference}. سيتصل بك الفريق خلال 3 أيام عمل.`);
        }
      } else if (/status|track|حالة|متابعة/i.test(message)) {
        if (!reference) text = say(ar, 'What is your case number? It looks like SR-1042.', 'ما رقم طلبك؟ يبدو مثل SR-1042.');
        else {
          const found = await lookupCase({ reference });
          text = found.status === 'not found' ? say(ar, `I could not find ${reference}.`, `لم أجد ${reference}.`) : say(ar, `Case ${reference} is ${found.status}.`, `الطلب ${reference} حالته ${found.status === 'open' ? 'مفتوح' : 'مغلق'}.`);
        }
      } else if (reference) {
        const found = await lookupCase({ reference });
        text = say(ar, `Case ${reference} is ${found.status}.`, `الطلب ${reference} حالته ${found.status}.`);
      } else text = say(ar, 'I can file a complaint or check a case for City Help Desk. This sample saves nothing.', 'أستطيع تسجيل شكوى أو متابعة طلب لمكتب خدمة المدينة. هذه العينة لا تحفظ شيئا.');
      turn.reply(text);
      return text;
    });
    return Response.json({ reply }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { const response = errorResponse(error, language); response.headers.set('cache-control', 'no-store'); return response; }
}
