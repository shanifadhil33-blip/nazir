import { publicSample } from '@/server/connect/sample-agent';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => publicSample(request, 'card');
