type QueuedRequest = { kind: string; queue: string; reference?: string; order_reference?: string | null };

/** Match each expected request once. Extra reviews are visible but do not act alone. */
export function compareRequestQueues(expected: readonly QueuedRequest[], fresh: readonly QueuedRequest[]) {
  const remaining = [...fresh];
  const missing = expected.filter((want) => {
    const index = remaining.findIndex((got) => got.kind === want.kind && got.queue === want.queue);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
  const describe = (r: QueuedRequest) => ({ kind: r.kind, queue: r.queue, ...(r.reference ? { reference: r.reference } : {}), ...(r.order_reference ? { order: r.order_reference } : {}) });
  return {
    pass: !missing.length && remaining.every((r) => r.kind === 'human_review'),
    observed: {
      requests: fresh.map(describe),
      extra_reviews: remaining.filter((r) => r.kind === 'human_review').map((r) => ({ ...describe(r), severity: 'low' as const })),
    },
  };
}
