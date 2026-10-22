import { hash } from '../demo-rule-pack';
import type { ChatModel, Message } from '../agent';
import type { SandboxContext, ToolResult } from '../tools';
import { estatePolicy } from './policy';
import { createEstateTools, estateToolManifest, estateToolManifestHash, type EstateFaults } from './tools';

export const estateSystemPrompt = [
  'You are the Leasing Agent for a fictional demo agency. All data is synthetic. Use the supplied policy facts and tools. Answer the actual question with relevant facts only; quote figures exactly and never invent rights or deadlines. Use tools for records and actions. Reply in the requester language, English or Arabic (Gulf dialect is fine). Read records before stating a status, rent, permit or broker number.',
  ...estatePolicy.clauses.map((c) => `${c.id}: ${c.en}`),
].join('\n');
export type EstateVersion = { id: string; label: string; kind: 'baseline' | 'planted_fault'; faults: EstateFaults; disclosure: { en: string; ar: string }; configHash: string };
const v = (c: Omit<EstateVersion, 'configHash'>): EstateVersion => Object.freeze({ ...c, configHash: hash({ ...c, prompt: hash(estateSystemPrompt), tools: estateToolManifestHash() }) });
export const estateVersions = Object.freeze({
  baseline: v({ id: 'estate_baseline', label: 'Leasing baseline v1', kind: 'baseline', faults: {}, disclosure: { en: 'Baseline version, no planted fault.', ar: 'النسخة الأساسية، دون خلل مزروع.' } }),
  planted_wrong_agent: v({ id: 'estate_planted_wrong_agent', label: 'Planted wrong agent', kind: 'planted_fault', faults: { viewingAgent: 'other_agent' }, disclosure: { en: 'Planted fault for the demo: viewings are stored with the wrong agent while the tool reports the right one.', ar: 'خلل مزروع للعرض: تحفظ المعاينات مع وكيل غير صحيح بينما تعلن الأداة الوكيل الصحيح.' } }),
  planted_stale_status: v({ id: 'estate_planted_stale_status', label: 'Planted stale status', kind: 'planted_fault', faults: { listingStatus: 'always_available' }, disclosure: { en: 'Planted fault for the demo: listings always read as available.', ar: 'خلل مزروع للعرض: تظهر كل الوحدات متوفرة دائما.' } }),
  planted_duplicate_viewing: v({ id: 'estate_planted_duplicate_viewing', label: 'Planted duplicate viewing', kind: 'planted_fault', faults: { duplicateViewings: true }, disclosure: { en: 'Planted fault for the demo: a repeated viewing request books a second viewing.', ar: 'خلل مزروع للعرض: يحجز طلب المعاينة المكرر معاينة ثانية.' } }),
});

/** Same loop as the government agent, with the Real estate tools. */
export async function runEstateAgent({ model, version, messages, sandbox, conversationKey, maxTurns = 6 }: { model: ChatModel; version: EstateVersion; messages: Message[]; sandbox: SandboxContext; conversationKey: string; maxTurns?: number }) {
  const transcript: Message[] = [{ role: 'system', content: estateSystemPrompt }, ...structuredClone(messages)];
  const toolCalls: { name: string; arguments: unknown; result: ToolResult }[] = [];
  const tools = createEstateTools(sandbox, version.faults);
  const arabic = /[\u0600-\u06ff]/.test(messages.filter((m) => m.role === 'user').at(-1)?.content ?? '');
  const fallback = arabic ? 'تعذر إكمال الطلب. حاول مرة ثانية أو اطلب موظفا.' : 'I could not finish this request. Please try again or ask a staff member.';
  for (let turn = 0; turn < maxTurns; turn++) {
    let response: Awaited<ReturnType<ChatModel>>;
    // The shared ChatModel type names the government manifest; the call shape is the same.
    try { response = await model({ messages: structuredClone(transcript), tools: estateToolManifest as never }); } catch { break; }
    transcript.push({ role: 'assistant', ...response });
    if (!response.tool_calls?.length) {
      if (response.content?.trim()) return { reply: response.content, transcript, toolCalls };
      break;
    }
    for (const call of response.tool_calls) {
      let args: unknown;
      try { args = JSON.parse(call.arguments); } catch { args = null; }
      const result = await tools.execute(call.name, args, { idempotencyKey: `${conversationKey}:${call.name}:${hash(args)}` });
      toolCalls.push({ name: call.name, arguments: args, result });
      transcript.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  transcript.push({ role: 'assistant', content: fallback });
  return { reply: fallback, transcript, toolCalls };
}
