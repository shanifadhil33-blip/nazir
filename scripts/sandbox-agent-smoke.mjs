import { pathToFileURL } from 'node:url';

/** The counter is shared across both journeys and counts failed provider calls too. */
export function cappedModel(model, maxCalls = 12) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1) throw new Error('MAX_CALLS must be a positive integer');
  let calls = 0;
  return {
    get calls() { return calls; },
    async model(request) {
      if (calls >= maxCalls) throw new Error('MAX_CALLS reached');
      calls++;
      return model(request);
    },
  };
}
async function main() {
  // Load the TypeScript module graph without writing compiled files.
  const { registerHooks } = await import('node:module');
  const { readFileSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { default: ts } = await import('typescript');
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
        const url = new URL(specifier + '.ts', context.parentURL);
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
      return nextLoad(url, context);
    },
  });
  const [{ PGlite }, { migrate }, { withWorker }, { runServiceAgent }, { baselineVersion }, { openAiCompatibleModel }] = await Promise.all([
    import('@electric-sql/pglite'), import('../src/server/db/migrate.ts'), import('../src/server/db/context.ts'),
    import('../src/sandbox/agent.ts'), import('../src/sandbox/versions.ts'), import('../src/sandbox/openai-model.ts'),
  ]);
  const pg = new PGlite();
  const wrap = (db) => ({ async query(sql, params) { if (params) return db.query(sql, params); return { rows: (await db.exec(sql)).at(-1)?.rows ?? [] }; } });
  const driver = { transaction: (work) => pg.transaction((tx) => work(wrap(tx))) };
  const budget = cappedModel(openAiCompatibleModel({
    url: process.env.SMOKE_MODEL_URL ?? 'https://ai-gateway.kilo.ai/api/v1/chat/completions',
    model: process.env.SMOKE_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free', apiKey: process.env.SMOKE_MODEL_KEY, timeoutMs: 30000,
  }), Number(process.env.MAX_CALLS ?? 12));
  try {
    await migrate(driver);
    for (const [language, turns] of [
      ['en', ['I have a complaint about an unresolved service request. I want human review.', 'Saeed Al Hashimi, SR-1042, my permit renewal is delayed.', 'Yes, I confirm. Please request human review.']],
      ['ar', ['أريد تقديم شكوى عن طلب سابق لم يحل وأطلب مراجعة بشرية.', 'أنا عمران قريشي، رقم الطلب SR-2077، لم تكتمل مراجعة المستند.', 'نعم، أؤكد إنشاء الحالة وأطلب مراجعة بشرية.']],
    ]) {
      const tenant = `smoke_${language}`;
      await withWorker(driver, '00000000-0000-0000-0000-000000000000', (db) => db.query('SELECT sandbox.seed_tenant($1)', [tenant]));
      let messages = [];
      const toolCalls = [];
      let reply = '';
      for (const content of turns) {
        messages.push({ role: 'user', content });
        const result = await runServiceAgent({ model: budget.model, version: baselineVersion, messages, sandbox: { driver, tenant, requesterKey: language === 'en' ? 'saeed' : 'imran' }, conversationKey: tenant });
        messages = result.transcript.filter((message) => message.role !== 'system');
        reply = result.reply;
        toolCalls.push(...result.toolCalls);
      }
      const records = await pg.query('SELECT c.reference,c.queue,c.status,e.queue AS escalation_queue FROM sandbox.cases c LEFT JOIN sandbox.escalations e ON c.id=e.case_id WHERE c.tenant=$1', [tenant]);
      console.log(JSON.stringify({ language, reply, toolCalls, records: records.rows, calls: budget.calls }, null, 2));
    }
  } finally { await pg.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Smoke run failed'); process.exitCode = 1; });
}
