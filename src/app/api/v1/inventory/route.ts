import { runtimeDriver } from '@/server/db/runtime';
import { errorResponse } from '@/server/http/errors';
import { ingestInventory } from '@/server/sdk/ingest';

export const dynamic = 'force-dynamic';
/** Called by the Nazir SDK with its Bearer key. Only sessions Nazir opened for that key's account accept data. */
export async function POST(request: Request) {
  try {
    return Response.json(await ingestInventory(runtimeDriver(), request), { status: 202, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set('cache-control', 'no-store');
    return response;
  }
}
