import { z } from 'zod';
import { planSize } from '@/server/packs/quick';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { approvePlan } from '@/server/memory/planner';

const input = z.object({
  reason: z.string().trim().min(10).max(2000),
  evidence_opened: z.literal(true),
  size: planSize.optional(),
  repeat_count: z.number().int().min(1).max(3).default(3),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; planId: string }> }) {
  const { workspaceId, planId } = await context.params;
  return memberRoute(workspaceId, async (memberId) => {
    const body = input.parse(await request.json());
    return approvePlan(runtimeDriver(), memberId, { id: planId, ...body });
  }, 200, requestLanguage(request));
}
