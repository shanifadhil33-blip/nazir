import { publicSample } from '@/server/connect/sample-agent';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => publicSample(request, 'a2a');
