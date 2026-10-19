export type Env = Record<string, string | undefined>;
export type Family = 'google_gemini' | 'nvidia_nemotron' | 'google_gemma' | 'openai_gpt_oss' | 'zhipu_glm' | 'alibaba_qwen' | 'unknown';
export type Model = { model: string; family: Family };
export type Provider = { id: string; url: string; keyEnv?: string; needsEnv?: string; timeoutMs: number; maxInFlight: number; minSpacingMs: number; perModelSpacing?: boolean; cap: number; models: Model[] };
const nemotron: Family = 'nvidia_nemotron';
export function providerRegistry(env: Env = process.env): Provider[] {
  const make = (id: string, url: string, keyEnv: string | undefined, cap: number, models: Model[], extra: Partial<Provider> = {}): Provider => ({ id, url, keyEnv, cap, models, timeoutMs: 30000, maxInFlight: 1, minSpacingMs: 0, ...extra });
  const registry = [
    make('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'GEMINI_API_KEY', 200, [{ model: 'gemini-3.5-flash-lite', family: 'google_gemini' }]),
    make('openrouter', 'https://openrouter.ai/api/v1/chat/completions', 'OPENROUTER_API_KEY', 20, [{ model: 'nvidia/nemotron-3-super-120b-a12b:free', family: nemotron }]),
    make('nvidia', 'https://integrate.api.nvidia.com/v1/chat/completions', 'NVIDIA_API_KEY', 500, [{ model: 'nvidia/nemotron-3-super-120b-a12b', family: nemotron }]),
    make('requesty', 'https://router.requesty.ai/v1/chat/completions', 'REQUESTY_API_KEY', 150, [{ model: 'nvidia/nemotron-3-ultra-550b-a55b', family: nemotron }, { model: 'google/gemma-4-31b-it', family: 'google_gemma' }], { timeoutMs: 12000, minSpacingMs: 12000 }),
    make('cloudflare', `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID ?? ''}/ai/v1/chat/completions`, 'CLOUDFLARE_AI_TOKEN', 100, [{ model: '@cf/openai/gpt-oss-120b', family: 'openai_gpt_oss' }], { needsEnv: 'CLOUDFLARE_ACCOUNT_ID' }),
    make('zai', 'https://api.z.ai/api/paas/v4/chat/completions', 'ZAI_API_KEY', 200, [{ model: 'glm-4.7-flash', family: 'zhipu_glm' }], { timeoutMs: 45000 }),
    make('kilo', 'https://ai-gateway.kilo.ai/api/v1/chat/completions', undefined, 400, [{ model: 'nvidia/nemotron-3-ultra-550b-a55b:free', family: nemotron }, { model: 'kilo-auto/free', family: 'unknown' }]),
    make('ovh', 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions', undefined, 400, [{ model: 'gpt-oss-120b', family: 'openai_gpt_oss' }, { model: 'Qwen3.5-397B-A17B', family: 'alibaba_qwen' }], { minSpacingMs: 30000, perModelSpacing: true }),
  ];
  for (const provider of registry) {
    const override = env[`AI_MODELS_${provider.id.toUpperCase()}`];
    if (override !== undefined) {
      const names = override.split(',').map((name) => name.trim()).filter(Boolean);
      if (names.some((name) => !provider.models.some((model) => model.model === name))) throw new Error('Model override refused');
      provider.models = [...new Set(names)].map((name) => provider.models.find((model) => model.model === name)!);
    }
    provider.cap = capValue(env[`AI_PROVIDER_CAP_${provider.id.toUpperCase()}`], provider.cap);
  }
  return registry;
}
export function capValue(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 0) throw new Error('Invalid call cap');
  return n;
}
export function chainOrder(providers: Provider[], purpose: 'agent' | 'judge', agentFamily?: Family) {
  if (purpose === 'judge' && (!agentFamily || agentFamily === 'unknown')) throw new Error('Judge needs a known agent family');
  const order: [string, number][] = purpose === 'agent'
    ? [['requesty',0],['kilo',0],['openrouter',0],['ovh',0],['ovh',1],['zai',0],['cloudflare',0],['gemini',0],['nvidia',0],['kilo',1]]
    : [['gemini',0],['requesty',1],['ovh',0],['zai',0],['cloudflare',0]];
  // Resolve fixed slots against the original list so removing a model never changes its purpose.
  const original = providerRegistry({});
  return order.flatMap(([id, index]) => {
    const provider = providers.find((p) => p.id === id)!;
    const name = original.find((p) => p.id === id)!.models[index]!.model;
    const model = provider.models.find((m) => m.model === name);
    return model && (purpose !== 'judge' || (model.family !== agentFamily && model.family !== 'unknown')) ? [{ provider, ...model }] : [];
  });
}
