/**
 * Time limits for one step request. A step route may run 60 s (its maxDuration; Next needs that as a literal in the
 * route file, and a test checks the two agree). Each step does bounded work: one conversation, given whatever is left
 * of a 50 s budget after the checks before it, and returns. The browser then calls again for the next conversation.
 * If there is too little time left to start a conversation, the step returns progress without claiming one.
 *
 * Leases: a claimed conversation's lease is 30 s, renewed every 10 s while the step is alive. If the route is killed at
 * its 60 s limit, the heartbeat stops and the lease runs out within 30 s, so the next step requeues it (recoverStale).
 */
export const stepRouteSeconds = 60;
export const stepBudgetMs = 50_000;
export const minConversationMs = 20_000;
export const stepLeaseSeconds = 30;

/** Time left for the conversation in this step, or 0 when too little is left to start one. */
export function conversationBudget(startedAt: number, now: number) {
  const left = stepBudgetMs - Math.max(0, now - startedAt);
  return left >= minConversationMs ? left : 0;
}
