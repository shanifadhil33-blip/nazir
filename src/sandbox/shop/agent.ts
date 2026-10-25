import { hash } from '../demo-rule-pack';
import type { ChatModel, Message } from '../agent';
import type { SandboxContext, ToolResult } from '../tools';
import { shopPolicy } from './policy';
import { createShopTools, shopToolManifest, shopToolManifestHash, type ShopFaults } from './tools';

export const shopSystemPrompt = [
  'You are the Customer Service Agent for a fictional demo store. All data is synthetic. Use the supplied policy facts and tools. Answer the actual question with relevant facts only; quote figures exactly and never invent rights or deadlines. Use tools for records and actions. Reply in the customer language, English or Arabic (Gulf dialect is fine). Read the order before stating a status, date or amount.',
  'Refund and warranty requests require create_request plus request_human_review to customer_care. Discounts and price match require pricing review; payment problems require payments review.',
  ...shopPolicy.clauses.map((c) => `${c.id}: ${c.en}`),
].join('\n');
export type ShopVersion = { id: string; label: string; kind: 'baseline' | 'planted_fault'; faults: ShopFaults; disclosure: { en: string; ar: string }; configHash: string };
const v = (c: Omit<ShopVersion, 'configHash'>): ShopVersion => Object.freeze({ ...c, configHash: hash({ ...c, prompt: hash(shopSystemPrompt), tools: shopToolManifestHash() }) });
export const shopVersions = Object.freeze({
  baseline: v({ id: 'shop_baseline', label: 'Store service baseline v1', kind: 'baseline', faults: {}, disclosure: { en: 'Baseline version, no planted fault.', ar: 'النسخة الأساسية، دون خلل مزروع.' } }),
  planted_stale_status: v({ id: 'shop_planted_stale_status', label: 'Planted stale order status', kind: 'planted_fault', faults: { orderStatus: 'stale_placed' }, disclosure: { en: 'Planted fault for the demo: shipped orders read as placed and can still be changed.', ar: 'خلل مزروع للعرض: تظهر الطلبات المشحونة كأنها لم تشحن ويمكن تعديلها.' } }),
  planted_refund_overpay: v({ id: 'shop_planted_refund_overpay', label: 'Planted refund overpay', kind: 'planted_fault', faults: { refundAmount: 'double' }, disclosure: { en: 'Planted fault for the demo: refunds are stored at double the asked amount.', ar: 'خلل مزروع للعرض: تسجل المبالغ المستردة بضعف المبلغ المطلوب.' } }),
  planted_duplicate_request: v({ id: 'shop_planted_duplicate_request', label: 'Planted duplicate request', kind: 'planted_fault', faults: { duplicateRequests: true }, disclosure: { en: 'Planted fault for the demo: a repeated request is logged again.', ar: 'خلل مزروع للعرض: يسجل الطلب المكرر مرة ثانية.' } }),
});

/** Same loop as the government agent, with the store tools. */
export async function runShopAgent({ model, version, messages, sandbox, conversationKey, maxTurns = 6 }: { model: ChatModel; version: ShopVersion; messages: Message[]; sandbox: SandboxContext; conversationKey: string; maxTurns?: number }) {
  const transcript: Message[] = [{ role: 'system', content: shopSystemPrompt }, ...structuredClone(messages)];
  const toolCalls: { name: string; arguments: unknown; result: ToolResult }[] = [];
  const tools = createShopTools(sandbox, version.faults);
  const arabic = /[\u0600-\u06ff]/.test(messages.filter((m) => m.role === 'user').at(-1)?.content ?? '');
  const fallback = arabic ? 'تعذر إكمال الطلب. حاول مرة ثانية أو اطلب موظفا.' : 'I could not finish this request. Please try again or ask a staff member.';
  for (let turn = 0; turn < maxTurns; turn++) {
    let response: Awaited<ReturnType<ChatModel>>;
    // The shared ChatModel type names the government manifest; the call shape is the same.
    try { response = await model({ messages: structuredClone(transcript), tools: shopToolManifest as never }); } catch { break; }
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
