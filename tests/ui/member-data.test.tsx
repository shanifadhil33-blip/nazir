import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
import { fetchMemberSnapshot } from '../../src/components/shell/member-data';
import { MemberSnapshotProvider, type MemberSnapshot } from '../../src/components/shell/member-snapshot';
import { HomeScreen } from '../../src/components/shell/home-screen';
import { ChecksScreen } from '../../src/components/shell/checks-screen';
import { FixesScreen } from '../../src/components/shell/fixes-screen';
import { SettingsScreen } from '../../src/components/shell/settings-screen';
import { HistoryScreen } from '../../src/components/shell/history-screen';
import { ReportScreen } from '../../src/components/shell/report-screen';
import { AgentMapScreen } from '../../src/components/shell/agent-map';
import { SafetyReportScreen } from '../../src/components/shell/safety-report';
import type { SafetyDetail } from '../../src/server/safety/read';
import { demoInventory, mapFromInventory } from '../../src/server/safety/map';

afterEach(() => vi.unstubAllGlobals());
const snapshot: MemberSnapshot = { workspaceId: 'workspace', lang: 'en', roles: ['service_owner'], assistant: 'Assistant', person: { name: 'Omar', initials: 'OH' }, fullName: 'Omar Haddad', settings: { name: 'Assistant', language: 'en' }, reports: [], fixes: [], history: { items: [], cursor: null } };

it.each(['home', 'checks', 'fixes', 'after', 'settings', 'history', 'report'])('%s renders ready from the server snapshot without browser globals or API calls', (screen) => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const props = { workspaceId: 'workspace', initialLang: 'en' as const };
  const content = screen === 'home' ? <HomeScreen {...props} /> : screen === 'checks' ? <ChecksScreen {...props} /> : screen === 'settings' ? <SettingsScreen {...props} /> : screen === 'history' ? <HistoryScreen {...props} /> : screen === 'report' ? <ReportScreen {...props} /> : <FixesScreen {...props} mode={screen === 'after' ? 'after' : 'fixes'} />;
  const value = screen === 'checks' ? { ...snapshot, activeRuns: [] } : snapshot;
  const html = renderToStaticMarkup(<MemberSnapshotProvider value={value}>{content}</MemberSnapshotProvider>);
  expect(html).not.toContain('Loading');
  expect(html).not.toContain('aria-busy="true"');
  expect(html).toContain('<main');
  expect(fetch).not.toHaveBeenCalled();
});

it('starts all member requests before any has resolved and keeps every request no-store', async () => {
  const resolve: ((r: Response) => void)[] = [];
  const fetch = vi.fn(() => new Promise<Response>((done) => resolve.push(done)));
  vi.stubGlobal('fetch', fetch);
  const loaded = fetchMemberSnapshot('workspace', 'en', false, true, true);
  expect(fetch).toHaveBeenCalledTimes(5);
  for (const call of fetch.mock.calls as unknown as [string, RequestInit][]) expect(call[1].cache).toBe('no-store');
  resolve[0]!(Response.json({ user: { name: 'Omar Haddad' }, memberships: [{ workspaceId: 'workspace', roles: ['viewer'], workspaceName: 'Desk' }] }));
  resolve[1]!(Response.json({ name: 'Assistant', language: 'ar' }));
  resolve[2]!(Response.json({ reports: [] }));
  resolve[3]!(Response.json({ proposals: [] }));
  resolve[4]!(Response.json({ ready: true, name: 'Agent', connection_kind: 'api' }));
  expect(await loaded).toMatchObject({ lang: 'ar', roles: ['viewer'], assistant: 'Agent · متصل', reports: [], fixes: [] });
});

it('keeps the exact old fix and comparison reports on client refresh', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  vi.stubGlobal('window', { location: { search: `?screen=after&fix=${id}` } });
  const fetch = vi.fn(async (path: string) => path === '/api/me'
    ? Response.json({ user: { name: 'Omar' }, memberships: [{ workspaceId: 'workspace', roles: ['service_owner'], kind: 'real' }] })
    : path.includes('/reports') ? Response.json({ reports: [] })
    : path.includes('/proposals') ? Response.json({ proposals: [{ id }] }) : Response.json({}));
  vi.stubGlobal('fetch', fetch);
  expect((await fetchMemberSnapshot('workspace', 'en', true, true, true))).toMatchObject({ fixes: [{ id }] });
  const urls = fetch.mock.calls.map(([url]) => url);
  expect(urls).toContain(`/api/workspaces/workspace/reports?fix=${id}`);
  expect(urls).toContain(`/api/workspaces/workspace/proposals?include=${id}`);
});

it('preserves the sign-in result on 401, including expired membership requests', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
  expect(await fetchMemberSnapshot('workspace', 'en', true, true, true)).toBe('unauthorized');
});

it('rejects another workspace and required report failures while tolerating optional settings/proposals failures', async () => {
  const me = { user: { name: 'Omar' }, memberships: [{ workspaceId: 'workspace', roles: ['viewer'], workspaceName: 'Desk' }] };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/api/me' ? Response.json(me) : path.endsWith('/reports') ? Response.json({ reports: [] }) : new Response(null, { status: 403 })));
  expect(await fetchMemberSnapshot('workspace', 'en', true, true, true)).toMatchObject({ assistant: 'No agent connected', connection: null, settings: null, fixes: [] });
  await expect(fetchMemberSnapshot('other', 'en', true, true, true)).rejects.toThrow();
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/api/me' ? Response.json(me) : new Response(null, { status: 403 })));
  await expect(fetchMemberSnapshot('workspace', 'en', true, true, true)).rejects.toThrow();
});

it('uses trusted account kind and connection on refresh, and never calls the workspace name an agent', async () => {
  for (const kind of ['real', 'demo']) {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/api/me' ? Response.json({ user: { name: 'Omar' }, memberships: [{ workspaceId: 'workspace', roles: ['service_owner'], workspaceName: 'Nazir demo', kind }] }) : path.endsWith('/connection') ? Response.json({ name: 'Customer desk', host: 'agent.example.com', ready: true, connection_kind: 'api' }) : Response.json({ name: 'Old settings name' })));
    expect(await fetchMemberSnapshot('workspace', 'en', true, false, false)).toMatchObject({ kind, connection: { ready: true }, assistant: kind === 'demo' ? 'City Help Desk · Connected' : 'Customer desk · Connected' });
  }
});
it('withholds Start for real missing or untested connections and preserves demo and tested Start', () => {
  for (const [kind, ready, start] of [['real', undefined, false], ['real', false, false], ['real', true, true], ['demo', undefined, true]] as const) {
    const value = { ...snapshot, kind, activeRuns: [], connection: ready === undefined ? null : { name: 'Desk', host: 'agent.example.com', ready } };
    const html = renderToStaticMarkup(<MemberSnapshotProvider value={value}><ChecksScreen workspaceId="workspace" initialLang="en" /></MemberSnapshotProvider>);
    expect(html.includes('data-nav="start"'), `${kind} ${ready}`).toBe(start);
  }
});

it.each(['en', 'ar'] as const)('renders the map and its exact detail from authorized first-paint data in %s', (lang) => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const agentMap = mapFromInventory(demoInventory, null);
  for (const itemId of [undefined, agentMap.items[0]!.id]) {
    const html = renderToStaticMarkup(<MemberSnapshotProvider value={{ ...snapshot, lang, agentMap }}><AgentMapScreen workspaceId="workspace" initialLang={lang} itemId={itemId} /></MemberSnapshotProvider>);
    expect(html).not.toContain('data-state="loading"');
    expect(html).toContain('data-state="ready"');
    expect(html).toContain(agentMap.items[0]!.name);
    if (itemId) expect(html).toContain('data-map-detail="' + itemId + '"');
    expect(fetch).not.toHaveBeenCalled();
  }
});

it('keeps the map fallback loading when first-paint data is unavailable', () => {
  const html = renderToStaticMarkup(<MemberSnapshotProvider value={{ ...snapshot, agentMap: null }}><AgentMapScreen workspaceId="workspace" initialLang="en" /></MemberSnapshotProvider>);
  expect(html).toContain('data-state="loading"');
  expect(html).not.toContain('data-map-detail');
});

const savedSafety: SafetyDetail = { id: '11111111-1111-4111-8111-111111111111', scope: 'full', status: 'done', agent: 'Omar agent', at: '2026-11-24T08:00:00Z', finishedAt: '2026-11-24T08:01:00Z', done: 40, total: 40, verdict: 'ready_safe', open: 0, weaknesses: [], resisted: ['S1'] };
it.each(['en', 'ar'] as const)('renders the saved safety list, exact detail and report in %s without an extra browser read', (lang) => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const value: MemberSnapshot = { ...snapshot, lang, activeRuns: [], safetyList: { runs: [savedSafety], confirmed: true, demo: true, agent: true, proof: null, nextAt: null }, safetyDetail: savedSafety };
  for (const view of ['list', 'detail', 'report']) {
    const content = view === 'report' ? <SafetyReportScreen workspaceId="workspace" runId={savedSafety.id} initialLang={lang} /> : <ChecksScreen workspaceId="workspace" initialLang={lang} initialTab="safety" initialSafety={view === 'detail' ? savedSafety.id : undefined} />;
    const html = renderToStaticMarkup(<MemberSnapshotProvider value={value}>{content}</MemberSnapshotProvider>);
    expect(html).not.toContain('data-state="loading"');
    expect(html).toContain('data-state="ready"');
    if (view === 'detail') expect(html).toContain('nz-safety-page');
    if (view === 'report') expect(html).toContain('data-verdict="ready_safe"');
    expect(fetch).not.toHaveBeenCalled();
  }
});

it('never renders another saved safety result from a mismatched first-paint ID', () => {
  const html = renderToStaticMarkup(<MemberSnapshotProvider value={{ ...snapshot, safetyDetail: savedSafety }}><SafetyReportScreen workspaceId="workspace" runId="22222222-2222-4222-8222-222222222222" initialLang="en" /></MemberSnapshotProvider>);
  expect(html).toContain('data-state="loading"');
  expect(html).not.toContain('data-verdict="ready_safe"');
});

it('keeps the saved safety heading with shaped placeholders while only its detail is unavailable', () => {
  const value: MemberSnapshot = { ...snapshot, activeRuns: [], safetyList: { runs: [savedSafety], confirmed: true, demo: true, agent: true, proof: null, nextAt: null } };
  const html = renderToStaticMarkup(<MemberSnapshotProvider value={value}><ChecksScreen workspaceId="workspace" initialLang="en" initialTab="safety" initialSafety={savedSafety.id} /></MemberSnapshotProvider>);
  expect(html).toContain('nz-safety-pending');
  expect(html).toContain('nz-safety-detail-loading');
  expect(html).not.toContain('nz-state-loading');
});
