import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import { activeChecksEmpty, initialActiveChecks, receiveActiveChecks } from '../../src/components/shell/checks-active';
import { readActiveRuns } from '../../src/components/shell/checks-run';
import { ChecksScreen } from '../../src/components/shell/checks-screen';
import { ChecksView } from '../../src/components/shell/checks';
import { homeLinks } from '../../src/components/shell/home-model';
import { MemberSnapshotProvider, type MemberSnapshot } from '../../src/components/shell/member-snapshot';

const queued = [{ runId: 'queued', done: 0, total: 8 }];
const snapshot: MemberSnapshot = { workspaceId: 'w', lang: 'en', roles: ['service_owner', 'quality_reviewer'], assistant: 'City Help Desk', person: undefined, fullName: '', settings: null, reports: [], fixes: [], activeRuns: queued };
afterEach(() => { vi.unstubAllGlobals(); });
const view = (active: ReturnType<typeof initialActiveChecks>) => renderToStaticMarkup(<ChecksView lang="en" seat="owner" phase="ready" checks={[]} access={{ start: true, stop: true, suggest: true }} assistant="City Help Desk" links={homeLinks('w')} now={new Date()} openId={null} openQuestion={null} running={active.runs[0] ?? null} active={active.runs} activeStatus={active.status} busy={null} note={null} />);

it('renders the queued server seed on first paint after reload or a fresh sign-in, without client fetches', () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (let visit = 0; visit < 2; visit++) {
    const html = renderToStaticMarkup(<MemberSnapshotProvider value={snapshot}><ChecksScreen workspaceId="w" initialLang="en" /></MemberSnapshotProvider>);
    expect(html).toContain('Checking now 0 of 8');
    expect(html).toContain('>Stop</button>');
    expect(html).not.toContain('Start a check');
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('waits for a delayed successful read before allowing automatic or manual Start', async () => {
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const fetcher = vi.fn(() => pending) as typeof fetch;
  let active = initialActiveChecks(null);
  const reading = readActiveRuns('w', 'en', fetcher).then((runs) => { active = receiveActiveChecks(active, runs); });
  await Promise.resolve();
  expect(activeChecksEmpty(active)).toBe(false);
  expect(view(active)).not.toContain('Start a check');
  resolve(Response.json({ runs: [] })); await reading;
  expect(activeChecksEmpty(active)).toBe(true);
  expect(view(active)).toContain('Start a check');
});

it('keeps the known card on failure and recovers with shared progress, then confirmed emptiness', async () => {
  let active = initialActiveChecks(queued);
  const failed = vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch;
  active = receiveActiveChecks(active, await readActiveRuns('w', 'en', failed));
  expect(active.status).toBe('error');
  expect(view(active)).toContain('Checking now 0 of 8');
  expect(view(active)).toContain('Try again');
  expect(view(active)).not.toContain('Start a check');
  const recovered = vi.fn(async () => Response.json({ runs: [{ run_id: 'queued', tries_done: 3, tries_total: 8 }] })) as typeof fetch;
  active = receiveActiveChecks(active, await readActiveRuns('w', 'en', recovered));
  expect(view(active)).toContain('Checking now 3 of 8');
  active = receiveActiveChecks(active, []);
  expect(view(active)).not.toContain('Checking now');
  expect(activeChecksEmpty(active)).toBe(true);
  active = receiveActiveChecks(active, null);
  expect(activeChecksEmpty(active)).toBe(false);
  expect(view(active)).not.toContain('Start a check');
});

it.each([null, {}, { runs: null }, { runs: {} }, { runs: [{}] }])('does not interpret malformed progress %j as empty', async (body) => {
  const fetcher = vi.fn(async () => Response.json(body)) as typeof fetch;
  const active = receiveActiveChecks(initialActiveChecks(), await readActiveRuns('w', 'en', fetcher));
  expect(active.status).toBe('error');
  expect(activeChecksEmpty(active)).toBe(false);
});

it('does not reuse a different workspace seed', () => {
  const html = renderToStaticMarkup(<MemberSnapshotProvider value={snapshot}><ChecksScreen workspaceId="other" initialLang="en" /></MemberSnapshotProvider>);
  expect(html).not.toContain('Checking now 0 of 8');
  expect(html).not.toContain('Start a check');
});
