import { publicKeySet } from '@/server/sdk/signing';

export const dynamic = 'force-dynamic';
/** Public keys the Nazir SDK uses to trust a test turn. Nothing secret is here. */
export function GET() {
  return Response.json(publicKeySet(), { headers: { 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' } });
}
