import { NotFound, errorResponse } from '@/server/http/errors';
import { sampleSdkAgent } from '@/server/connect/sample-sdk-agent';

export const dynamic = 'force-dynamic';
/** Public sample agent with the Nazir SDK inside: /api/sample-sdk/honest or /api/sample-sdk/lying. */
export async function POST(request: Request, context: { params: Promise<{ mode: string }> }) {
  const { mode } = await context.params;
  if (mode !== 'honest' && mode !== 'lying') return errorResponse(new NotFound());
  return sampleSdkAgent(request, mode);
}
