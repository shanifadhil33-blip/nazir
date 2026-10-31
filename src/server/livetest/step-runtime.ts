import 'server-only';
import { inspectionRuntimeDriver } from '../db/runtime';
import { runNextConversation } from '../runner/worker';
import { networkChatModel } from '../runner/network-model';
import { networkJudge } from '../runner/network-judge';
import type { StepDeps } from './live-test';
import { stepLeaseSeconds } from './budget';

/**
 * One conversation of one live run, inside the request. Calls go through the same free chain, daily cap and own key rules as the box runner.
 * The conversation gets what is left of the step budget (at most 50 s, for a 60 s route) and a 30 s lease renewed every 10 s.
 */
export const runtimeStep: StepDeps = {
  inspectionDriver: inspectionRuntimeDriver,
  run: ({ driver, inspectionDriver, runId, budgetMs }) => runNextConversation({ driver, inspectionDriver, runId, workerId: 'live_test', conversationTimeoutMs: budgetMs, leaseSeconds: stepLeaseSeconds,
    chatModelFactory: (context) => networkChatModel(driver, context, {}), judgeFactory: (context) => networkJudge(driver, context, {}) }),
};
