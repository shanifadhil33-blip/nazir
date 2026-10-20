import 'server-only';
import { inspectionRuntimeDriver } from '../db/runtime';
import { runNextConversation } from '../runner/worker';
import { networkChatModel } from '../runner/network-model';
import { networkJudge } from '../runner/network-judge';
import type { StepDeps } from './live-test';

/** One conversation of one live run, inside the request. Calls go through the same free chain, daily cap and own key rules as the box runner. */
export const runtimeStep: StepDeps = {
  inspectionDriver: inspectionRuntimeDriver,
  run: ({ driver, inspectionDriver, runId }) => runNextConversation({ driver, inspectionDriver, runId, workerId: 'live_test', conversationTimeoutMs: 100000,
    chatModelFactory: (context) => networkChatModel(driver, context, {}), judgeFactory: (context) => networkJudge(driver, context, {}) }),
};
