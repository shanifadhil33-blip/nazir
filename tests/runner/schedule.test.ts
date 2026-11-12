import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ after: [] as (() => Promise<void>)[] }));
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => { hooks.after.push(fn); } }));
const runtime = vi.hoisted(() => ({ tick: vi.fn(), lock: vi.fn() }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: () => ({}), inspectionRuntimeDriver: () => ({}), runnerLock: runtime.lock }));
vi.mock('../../src/server/runner/tick', () => ({ tick: runtime.tick }));
import { busyDelayMs, runnerUrl, scheduleRunner } from '../../src/server/runner/schedule';
import { POST, maxDuration } from '../../src/app/api/runner/tick/route';

beforeEach(() => {
  vi.stubEnv('AUTH_URL', undefined);
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', undefined);
  vi.stubEnv('VERCEL_URL', undefined);
});
afterEach(() => { hooks.after = []; vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });
it('requires the configured secret before accepting a POST, without echoing authentication', async () => {
  expect(maxDuration).toBe(300);
  vi.stubEnv('CRON_SECRET', 'test_tick_secret');
  for (const value of [null, 'Bearer wrong', 'test_tick_secret']) {
    const response = await POST(new Request('https://example.test/api/runner/tick', { method: 'POST', ...(value ? { headers: { authorization: value } } : {}) }));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('test_tick_secret');
  }
  vi.stubEnv('CRON_SECRET', '');
  expect((await POST(new Request('https://example.test/api/runner/tick', { method: 'POST', headers: { authorization: 'Bearer test_tick_secret' } }))).status).toBe(401);
  expect(hooks.after).toHaveLength(0);
});
it('owns work after the response and chains a new authenticated tick when its budget ends', async () => {
  vi.stubEnv('CRON_SECRET', 'test_tick_secret'); vi.stubEnv('VERCEL_URL', 'preview.example.test');
  runtime.tick.mockResolvedValue({ pending: true, busy: false });
  const fetcher = vi.fn(async () => new Response(null, { status: 202 })); vi.stubGlobal('fetch', fetcher);
  const response = await POST(new Request('https://untrusted.example/api/runner/tick', { method: 'POST', headers: { authorization: 'Bearer test_tick_secret' } }));
  expect(response.status).toBe(202);
  expect(runtime.tick).not.toHaveBeenCalled();
  await hooks.after.shift()!();
  expect(hooks.after).toHaveLength(1);
  await hooks.after.shift()!();
  expect(fetcher).toHaveBeenCalledWith(new URL('https://preview.example.test/api/runner/tick'), expect.objectContaining({ method: 'POST', headers: { authorization: 'Bearer test_tick_secret' }, redirect: 'error' }));
});
it('registers the initial kick before Start returns, so it needs no browser', async () => {
  vi.stubEnv('CRON_SECRET', 'test_tick_secret'); vi.stubEnv('VERCEL_URL', 'preview.example.test');
  const fetcher = vi.fn(async () => new Response(null, { status: 202 })); vi.stubGlobal('fetch', fetcher);
  expect(scheduleRunner()).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  await hooks.after.shift()!();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('stops chaining only when idle', async () => {
  vi.stubEnv('CRON_SECRET', 'test_tick_secret');
  runtime.tick.mockResolvedValue({ pending: false, busy: false });
  await POST(new Request('https://example.test/api/runner/tick', { method: 'POST', headers: { authorization: 'Bearer test_tick_secret' } }));
  await hooks.after.shift()!();
  expect(hooks.after).toHaveLength(0);
});
it('chains a busy tick after a short delay even without pending work', async () => {
  vi.useFakeTimers();
  vi.stubEnv('CRON_SECRET', 'test_tick_secret'); vi.stubEnv('VERCEL_URL', 'preview.example.test');
  runtime.tick.mockResolvedValue({ pending: false, busy: true });
  const fetcher = vi.fn(async () => new Response(null, { status: 202 })); vi.stubGlobal('fetch', fetcher);
  await POST(new Request('https://example.test/api/runner/tick', { method: 'POST', headers: { authorization: 'Bearer test_tick_secret' } }));
  await hooks.after.shift()!();
  expect(hooks.after).toHaveLength(1);
  const chained = hooks.after.shift()!();
  await vi.advanceTimersByTimeAsync(busyDelayMs - 1);
  expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await chained;
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('chains again after a tick exception', async () => {
  vi.stubEnv('CRON_SECRET', 'test_tick_secret'); vi.stubEnv('VERCEL_URL', 'preview.example.test');
  runtime.tick.mockRejectedValue(new Error('Database unavailable'));
  const fetcher = vi.fn(async () => new Response(null, { status: 202 })); vi.stubGlobal('fetch', fetcher);
  await POST(new Request('https://example.test/api/runner/tick', { method: 'POST', headers: { authorization: 'Bearer test_tick_secret' } }));
  await hooks.after.shift()!();
  expect(hooks.after).toHaveLength(1);
  await hooks.after.shift()!();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('uses deployment configuration for secrets, never the incoming Host', () => {
  expect(runnerUrl({ VERCEL_URL: 'preview.example.test' })?.origin).toBe('https://preview.example.test');
  expect(runnerUrl({ AUTH_URL: 'https://example.test' })?.pathname).toBe('/api/runner/tick');
  expect(runnerUrl({ AUTH_URL: 'http://example.test' })).toBeNull();
  expect(runnerUrl({ AUTH_URL: 'https://user:password@example.test' })).toBeNull();
  expect(runnerUrl({})).toBeNull();
});
it('prefers AUTH_URL over the unique deployment URL', () => {
  expect(runnerUrl({ AUTH_URL: 'https://public.example.test', VERCEL_URL: 'preview.example.test' })?.href).toBe('https://public.example.test/api/runner/tick');
});
it.each(['production.example.test', 'https://production.example.test'])('uses the production URL fallback %s ahead of the unique deployment URL', (productionUrl) => {
  expect(runnerUrl({ VERCEL_PROJECT_PRODUCTION_URL: productionUrl, VERCEL_URL: 'preview.example.test' })?.href).toBe('https://production.example.test/api/runner/tick');
});
it('prefers AUTH_URL when all three origins are configured', () => {
  expect(runnerUrl({ AUTH_URL: 'https://public.example.test', VERCEL_PROJECT_PRODUCTION_URL: 'production.example.test', VERCEL_URL: 'preview.example.test' })?.href).toBe('https://public.example.test/api/runner/tick');
});
it('rejects unsafe preferred origins even when a lower priority origin is available', () => {
  const env = { VERCEL_PROJECT_PRODUCTION_URL: 'production.example.test', VERCEL_URL: 'preview.example.test' };
  expect(runnerUrl({ ...env, AUTH_URL: 'http://public.example.test' })).toBeNull();
  const userinfo = new URL('https://public.example.test');
  userinfo.username = 'user';
  userinfo.password = 'password';
  expect(runnerUrl({ ...env, AUTH_URL: userinfo.href })).toBeNull();
  expect(runnerUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'http://production.example.test', VERCEL_URL: env.VERCEL_URL })).toBeNull();
  expect(runnerUrl({ VERCEL_PROJECT_PRODUCTION_URL: userinfo.href })).toBeNull();
});
it('allows localhost http only in development, including the local fallback', () => {
  expect(runnerUrl({ NODE_ENV: 'development' })?.href).toBe('http://localhost:3000/api/runner/tick');
  expect(runnerUrl({ NODE_ENV: 'development', AUTH_URL: 'http://localhost:3000' })?.href).toBe('http://localhost:3000/api/runner/tick');
  expect(runnerUrl({ NODE_ENV: 'production', AUTH_URL: 'http://localhost:3000' })).toBeNull();
  expect(runnerUrl({ NODE_ENV: 'development', AUTH_URL: 'http://public.example.test' })).toBeNull();
  expect(runnerUrl({ NODE_ENV: 'production' })).toBeNull();
});
it('schedules only after the new run and its trusted starter audit have committed', async () => {
  const { testDatabase } = await import('../helpers/pglite');
  const { createLibraryFixture } = await import('../../src/server/runner/library-fixture');
  const { proposeBoundedPlan, startBoundedRun } = await import('../../src/server/planner/bound');
  const { approvePlan } = await import('../../src/server/memory/planner');
  const db = await testDatabase();
  try {
    const f = await db.driver.transaction(createLibraryFixture);
    const rules = (await db.owner.query<{ rule_pack_version_id: string }>('SELECT rule_pack_version_id FROM nazir.plans WHERE id=$1', [f.planId])).rows[0]!.rule_pack_version_id;
    const plan = await proposeBoundedPlan(db.driver, f.members.author, { size: 'quick', agent_version_id: f.versions[0]!.id, rule_pack_version_id: rules });
    await approvePlan(db.driver, f.members.reviewer, { id: plan.id, reason: 'I reviewed these questions.', evidence_opened: true });
    vi.stubEnv('CRON_SECRET', 'test_tick_secret'); vi.stubEnv('VERCEL_URL', 'preview.example.test');
    const run = await startBoundedRun(db.driver, f.members.reviewer, plan.id);
    expect(hooks.after).toHaveLength(1);
    expect((await db.owner.query("SELECT payload->>'started_by' AS starter FROM nazir.audit_events WHERE action='run_enqueued' AND target_id=$1", [run.id])).rows[0]!.starter).toBe(f.members.reviewer);
    const fetcher = vi.fn(async () => new Response(null, { status: 202 })); vi.stubGlobal('fetch', fetcher);
    await hooks.after.shift()!(); expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { await db.close(); }
});
