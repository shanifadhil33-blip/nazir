import { pathToFileURL } from 'node:url';
export function probeOptions(env = /** @type {Record<string, string | undefined>} */ (process.env)) {
  const max = Number(env.MAX_CALLS ?? 6);
  if (!Number.isSafeInteger(max) || max < 1) throw new Error('MAX_CALLS must be a positive integer');
  const purpose = env.PROBE_PURPOSE ?? 'agent';
  if (!['agent','judge'].includes(purpose)) throw new Error('Invalid probe purpose');
  const families = ['google_gemini','nvidia_nemotron','google_gemma','openai_gpt_oss','zhipu_glm','alibaba_qwen'];
  if (purpose === 'judge' && !families.includes(env.PROBE_AGENT_FAMILY)) throw new Error('Judge needs a known agent family');
  return { maxCalls: Math.min(max,20), purpose, agentFamily: env.PROBE_AGENT_FAMILY, forcedDown: new Set((env.PROBE_FORCE_DOWN ?? '').split(',').map((id) => id.trim()).filter(Boolean)) };
}
export const probeTools = [{ type:'function',function:{ name:'create_case',description:'Create a confirmed complaint case in the fictional sandbox.',parameters:{ type:'object',properties:{ category:{ type:'string',enum:['complaint','suggestion','information'] },prior_request_ref:{ type:'string' },requester_name:{ type:'string' },needs_human_review:{ type:'boolean' } },required:['category','prior_request_ref','requester_name','needs_human_review'],additionalProperties:false } } }];
export const probeMessages = [
  { role:'system',content:'You are a fictional government service agent in a test sandbox. Use the create_case tool when the requester confirms a complaint. Synthetic data only.' },
  { role:'user',content:'طلبي السابق رقم SR-1042 ما زال دون حل منذ ثلاثة أسابيع. أؤكد أنني أريد تسجيل شكوى وإرسالها للمراجعة البشرية. اسمي سعيد الهاشمي.' },
];
export async function runProbe({ createAiChain, memoryAiStore, fetch: fetcher, env = /** @type {Record<string, string | undefined>} */ (process.env), scenarios = false, print = console.log }) {
  const options = probeOptions(env);
  let calls = 0, firstExhausted = false;
  const store = memoryAiStore();
  const reserve = store.reserve.bind(store);
  store.reserve = async (...args) => calls < options.maxCalls && reserve(...args);
  const forcedDown = options.forcedDown;
  const chain = createAiChain({ store, env, forcedDown, fetch: async (...args) => {
    if (calls >= options.maxCalls) throw new Error('MAX_CALLS reached');
    calls++;
    return fetcher(...args);
  } });
  for (let scenario = 0; scenario < (scenarios ? 3 : 1) && calls < options.maxCalls; scenario++) {
    let attempts = [], answer;
    try {
      answer = await chain.chat({ purpose:options.purpose,task:'probe',agentFamily:options.agentFamily,messages:probeMessages,tools:probeTools,maxTokens:300,temperature:0,
        validate: (reply) => reply.tool_calls?.some((call) => call.name === 'create_case') ? null : 'invalid_tool_args' });
      attempts = answer.meta.attempts;
    } catch (error) {
      attempts = error.attempts ?? [];
      if (scenario === 0) firstExhausted = true;
    }
    print(`scenario ${scenario + 1}`);
    for (const a of attempts) print(`${a.provider} | ${a.model} | ${a.outcome} | ${a.reason} | ${a.httpStatus ?? 'none'} | ${a.latencyMs}ms`);
    if (!answer) { print('exhausted'); break; }
    print(`answer ${answer.meta.provider} | failover ${answer.meta.failover}`);
    forcedDown.add(answer.meta.provider);
  }
  return { calls, exitCode:firstExhausted ? 1 : 0 };
}
async function main() {
  const { registerHooks } = await import('node:module');
  const { readFileSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { default: ts } = await import('typescript');
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
        const url = new URL(specifier + '.ts', context.parentURL);
        if (existsSync(url)) return { url:url.href,shortCircuit:true };
      }
      return nextResolve(specifier,context);
    },
    load(url, context, nextLoad) {
      if (url.endsWith('.ts')) return { format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{ compilerOptions:{ module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022 } }).outputText };
      return nextLoad(url,context);
    },
  });
  const [{ createAiChain },{ memoryAiStore }] = await Promise.all([import('../src/server/ai/chain.ts'),import('../src/server/ai/store.ts')]);
  const result = await runProbe({ createAiChain,memoryAiStore,fetch:globalThis.fetch,scenarios:process.argv.includes('--scenarios') });
  process.exitCode = result.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Probe failed'); process.exitCode = 1; });
