import { describe, expect, it, vi } from 'vitest';
import { ACTIVE_POLL_MS, IDLE_POLL_MS, KICK_EVERY_MS, createHomeRefresh, homeRefreshMemory, nextPollDelay } from '../../src/components/shell/home-refresh';
import type { RunProgress } from '../../src/components/shell/checks-run';

const run = (runId: string, done = 1): RunProgress => ({ runId, done, total: 8 });

function harness(seed: RunProgress[] | null, reads: (RunProgress[] | null | Error)[]) {
  const memory = homeRefreshMemory(seed);
  let clock = 0;
  const calls = { reload: 0, kicks: [] as string[], received: [] as (RunProgress[] | null)[] };
  const read = vi.fn(async () => {
    const next = reads.length > 1 ? reads.shift()! : reads[0]!;
    if (next instanceof Error) throw next;
    return next;
  });
  const polling = createHomeRefresh(memory, {
    read,
    receive: (runs) => { calls.received.push(runs); },
    kick: async (id) => { calls.kicks.push(id); },
    reload: () => { calls.reload += 1; },
    now: () => clock,
  });
  return { memory, polling, calls, read, tick: (ms: number) => { clock += ms; } };
}

describe('Home refresh', () => {
  it('never reloads the page data on a quiet Home, even over a long idle watch', async () => {
    const h = harness([], [[]]);
    for (let i = 0; i < 6; i += 1) { await h.polling.refresh(); h.tick(IDLE_POLL_MS); }
    expect(h.calls.reload).toBe(0);
    expect(h.calls.kicks).toEqual([]);
    expect(nextPollDelay(h.memory)).toBe(IDLE_POLL_MS);
  });

  it('treats unknown then empty as quiet', async () => {
    const h = harness(null, [[]]);
    await h.polling.refresh(); await h.polling.refresh();
    expect(h.calls.reload).toBe(0);
  });

  it('reloads exactly once when a running check finishes', async () => {
    const h = harness([run('a')], [[run('a', 4)], [], []]);
    expect(nextPollDelay(h.memory)).toBe(ACTIVE_POLL_MS);
    await h.polling.refresh(); await h.polling.refresh(); await h.polling.refresh();
    expect(h.calls.reload).toBe(1);
    expect(nextPollDelay(h.memory)).toBe(IDLE_POLL_MS);
  });

  it('keeps the running card through a failed read, then reloads once when the check is gone', async () => {
    const h = harness([run('a')], [new Error('offline'), null, [], []]);
    await h.polling.refresh(); await h.polling.refresh();
    expect(h.calls.received).toEqual([null, null]);
    expect(h.memory.ids.has('a')).toBe(true);
    expect(h.calls.reload).toBe(0);
    await h.polling.refresh(); await h.polling.refresh();
    expect(h.calls.reload).toBe(1);
  });

  it('reloads when one check ends while another keeps running, and again for a later one', async () => {
    const h = harness([run('a'), run('b')], [[run('b')], [run('b')], [run('b'), run('c')], [run('b')]]);
    await h.polling.refresh(); expect(h.calls.reload).toBe(1);
    await h.polling.refresh(); expect(h.calls.reload).toBe(1);
    await h.polling.refresh(); expect(h.calls.reload).toBe(1);
    await h.polling.refresh(); expect(h.calls.reload).toBe(2);
  });

  it('kicks a running check at most once every 20 seconds', async () => {
    const h = harness([run('a')], [[run('a')]]);
    await h.polling.refresh(); h.tick(ACTIVE_POLL_MS);
    await h.polling.refresh(); h.tick(ACTIVE_POLL_MS);
    await h.polling.refresh();
    expect(h.calls.kicks).toEqual(['a']);
    h.tick(KICK_EVERY_MS);
    await h.polling.refresh();
    expect(h.calls.kicks).toEqual(['a', 'a']);
  });

  it('never runs two reads at once and a retry reloads only once', async () => {
    const h = harness([run('a')], [[]]);
    const first = h.polling.refresh(); const second = h.polling.refresh(true);
    await Promise.all([first, second]);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.calls.reload).toBe(1);
  });

  it('ignores a response that lands after the Home closed', async () => {
    const h = harness([run('a')], [[]]);
    const pending = h.polling.refresh();
    h.polling.dispose();
    await pending;
    expect(h.calls.received).toEqual([]);
    expect(h.calls.reload).toBe(0);
    await h.polling.refresh();
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it('keeps what it saw across a restart of the effect, so a stale seed does not come back', async () => {
    const memory = homeRefreshMemory([run('a')]);
    let reloads = 0;
    const effects = (reads: RunProgress[][]) => ({ read: async () => reads.shift() ?? [], receive: () => {}, kick: async () => {}, reload: () => { reloads += 1; } });
    const one = createHomeRefresh(memory, effects([[]]));
    await one.refresh(); one.dispose();
    const two = createHomeRefresh(memory, effects([[]]));
    await two.refresh();
    expect(reloads).toBe(1);
  });
});
