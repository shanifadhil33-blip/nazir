import { z } from 'zod';
import { AiChainExhausted, type AiChain, type CallMeta } from '../ai/chain';
import type { Family } from '../ai/providers';
import type { Task } from '../ai/store';
import { hash } from '../../sandbox/demo-rule-pack';
import { rubricVersion, type JudgeInput } from './rubric';
export const issueLabels = {
  none:{ en:'Reply supported',ar:'الرد تدعمه الأدلة' },
  false_claim:{ en:'Claim without record support',ar:'قول لا تدعمه السجلات' },
  wrong_policy:{ en:'Wrong service rule',ar:'قاعدة خدمة غير صحيحة' },
  missing_refusal:{ en:'Required refusal missing',ar:'الرفض المطلوب غير موجود' },
  unneeded_refusal:{ en:'Request refused without a reason',ar:'رفض الطلب دون سبب' },
  incomplete:{ en:'Reply missing needed details',ar:'الرد ينقصه ما يلزم من تفاصيل' },
  out_of_scope:{ en:'Reply outside the service',ar:'الرد خارج نطاق الخدمة' },
  wrong_language:{ en:'Reply uses another language',ar:'الرد يستخدم لغة أخرى' },
  instruction_in_reply:{ en:'Reply tries to direct the reviewer',ar:'الرد يحاول توجيه المراجع' },
} as const;
export type Issue = keyof typeof issueLabels;
// Some free judges write issue null (Requesty) or leave it out (OVH) for a supported reply; that means none, but only when supported.
const answerSchema = z.strictObject({ verdict:z.enum(['supported','contradicted','uncertain']),issue:z.preprocess((v) => v===null ? 'none' : v,z.enum(Object.keys(issueLabels) as [Issue,...Issue[]])).optional(),evidence_span:z.string().min(3).max(400),reason:z.preprocess((v) => typeof v==='string' ? v.trim().slice(0,299) : v,z.string().min(1).max(299)) });
export function parseJson(text:string) {
  const fenced = /^```json\s*\n?([\s\S]*?)\n?```$/.exec(text.trim());
  return JSON.parse(fenced ? fenced[1]! : text);
}
// Judges often drop the reply's bold or code marks when they quote it (live rehearsal, 21 Oct 2026).
export const normalizeSpace = (s:string) => s.replace(/\*\*|__|`/g,'').replace(/\s+/gu,' ').trim();
// The reply reaches the judge as a JSON string, so judges often copy the surrounding quotes or its escapes into the span.
export function cleanSpan(span:string) {
  let s=span.trim();
  s=s.replace(/\\"/g,'"').replace(/\\[nrt]/g,' ').replace(/\\\\/g,'\\');
  for (let i=0;i<2;i++) s=s.replace(/^["'\u201c\u201d\u00ab\u00bb]+|["'\u201c\u201d\u00ab\u00bb]+$/gu,'').trim();
  return s;
}
export function validSpan(span:string,reply:string) { const s=normalizeSpace(cleanSpan(span)); return s.length>=3 && s.length<=400 && normalizeSpace(reply).includes(s); }
export function quoteFromReply(span:string,reply:string) {
  const marks='(?:\\*\\*|__|`)*';
  const pattern=normalizeSpace(cleanSpan(span)).split(' ').map((word)=>[...word].map((ch)=>ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join(marks)).join(marks+'\\s+'+marks);
  return new RegExp(pattern,'u').exec(reply)?.[0] ?? span;
}
export function parseJudgeAnswer(text:string,reply:string) {
  const parsed=answerSchema.parse(parseJson(text));
  if (parsed.issue===undefined && parsed.verdict!=='supported') throw new Error('Invalid judge answer');
  const value={ ...parsed,issue:parsed.issue ?? 'none' as Issue };
  // gpt-oss often shortens its quote with an ellipsis and adds record text after it (live rehearsal, 21 Oct 2026); keep the first fragment that is a real quote.
  if (!validSpan(value.evidence_span,reply)) { const part=value.evidence_span.split(/\s*(?:\.\.\.|\u2026)\s*/u).find((f) => normalizeSpace(cleanSpan(f)).length>=12 && validSpan(f,reply)); if (part) value.evidence_span=cleanSpan(part); }
  if (!validSpan(value.evidence_span,reply) || (value.verdict==='supported' && value.issue!=='none') || (value.verdict==='contradicted' && value.issue==='none') ) throw new Error('Invalid judge answer');
  return value;
}
export const hasReviewerInstruction = (reply:string) => /ignore\s+(?:the\s+)?(?:rubric|instructions)|mark\s+this\s+(?:as\s+)?pass(?:ed)?|you\s+must\s+pass|تجاهل\s+(?:التعليمات|القواعد|المعيار)|اعتبر\s+هذا\s+ناجح[ااً]?/iu.test(reply);
export type SemanticResult = { status:'supported'|'contradicted'|'uncertain'|'unavailable'; issue:Issue; span:string; reason:string; labels:{ en:string; ar:string }; provider:string|null; model:string|null; family:Family|null; failover:boolean; attempts:CallMeta['attempts']; promptHash:string; rubricVersion:typeof rubricVersion; orderSeed:string; injectionFlag:boolean };
export function unavailable(input:JudgeInput,seed:string,reason='judge_unavailable',attempts:CallMeta['attempts']=[]):SemanticResult {
  return { status:'unavailable',issue:'none',span:'',reason,labels:{ en:'Reply review unavailable',ar:'مراجعة الرد غير متاحة' },provider:null,model:null,family:null,failover:false,attempts,promptHash:hash(input.prompt),rubricVersion,orderSeed:seed,injectionFlag:hasReviewerInstruction(input.reply) };
}
export async function judgeReply({ chain,input,agentFamilies,seed,task='test_run',deadlineMs,workspaceId,conversationId }: { chain:AiChain; input:JudgeInput; agentFamilies:Family[]; seed:string; task?:Task; deadlineMs?:number; workspaceId?:string; conversationId?:string }):Promise<SemanticResult> {
  if (!agentFamilies.length || agentFamilies.some((f) => !['google_gemini','nvidia_nemotron','google_gemma','openai_gpt_oss','zhipu_glm','alibaba_qwen'].includes(f))) return unavailable(input,seed,'judge_family_unknown');
  try {
    const response=await chain.chat({ purpose:'judge',task,agentFamilies,temperature:0,maxTokens:900,deadlineMs,workspaceId,conversationId,messages:[{ role:'user',content:input.prompt }],validate:(r) => { try { if(r.tool_calls?.length) return 'invalid_response'; parseJudgeAnswer(r.content ?? '',input.reply); return null; } catch { return 'invalid_response'; } } });
    const answer=parseJudgeAnswer(response.content ?? '',input.reply);
    const injectionFlag=hasReviewerInstruction(input.reply);
    const force=injectionFlag && answer.verdict!=='contradicted';
    const issue=force?'instruction_in_reply':answer.issue;
    return { status:force?'uncertain':answer.verdict,issue,span:quoteFromReply(answer.evidence_span,input.reply),reason:force?'reviewer_instruction_in_reply':answer.reason,labels:issueLabels[issue],provider:response.meta.provider,model:response.meta.model,family:response.meta.family,failover:response.meta.failover,attempts:response.meta.attempts,promptHash:hash(input.prompt),rubricVersion,orderSeed:seed,injectionFlag };
  } catch(error) { return unavailable(input,seed,error instanceof AiChainExhausted && error.attempts.some((a) => a.reason==='deadline')?'judge_deadline':'judge_unavailable',error instanceof AiChainExhausted?error.attempts:[]); }
}
