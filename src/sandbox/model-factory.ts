import { openAiCompatibleModel } from './openai-model';
export function createAgentModel() {
  return openAiCompatibleModel({
    url: process.env.SANDBOX_AGENT_MODEL_URL ?? 'https://ai-gateway.kilo.ai/api/v1/chat/completions',
    model: process.env.SANDBOX_AGENT_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free',
    apiKey: process.env.SANDBOX_AGENT_MODEL_KEY, timeoutMs: 30000,
  });
}
