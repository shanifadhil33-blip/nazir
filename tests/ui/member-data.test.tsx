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

afterEach(() => vi.unstubAllGlobals());
const snapshot: MemberSnapshot = { workspaceId: 'workspace', lang: 'en', roles: ['service_owner'], assistant: 'Assistant', person: { name: 'Omar', initials: 'OH' }, fullName: 'Omar Haddad', settings: { name: 'Assistant', language: 'en' }, reports: [], fixes: [] };

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
