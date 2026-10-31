import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SqlConnection, TransactionDriver } from '../src/server/db/driver';
const fake = vi.hoisted(() => ({ auth: vi.fn(), signIn: vi.fn(), runtimeDriver: vi.fn(), pending: false }));
vi.mock('../src/auth', () => ({ auth: fake.auth, signIn: fake.signIn }));
vi.mock('react-dom', async (orig) => ({ ...(await orig<typeof import('react-dom')>()), useFormStatus: () => ({ pending: fake.pending }) }));
import { SignInButton } from '../src/components/sign-in-button';
import WorkspaceLoading from '../src/app/w/loading';
import WorkspaceIdLoading from '../src/app/w/[workspaceId]/loading';
vi.mock('../src/server/db/runtime', () => ({ runtimeDriver: fake.runtimeDriver }));
import HomePage from '../src/app/page';
import WorkspacesPage from '../src/app/w/page';
import PrivacyPage from '../src/app/privacy/page';
import TermsPage from '../src/app/terms/page';

beforeEach(() => {
  fake.auth.mockReset().mockResolvedValue(null);
  fake.runtimeDriver.mockReset();
});

it('Shows both fictional service banners on the home page', async () => {
  const html = renderToStaticMarkup(await HomePage());
  expect(html).toContain('Fictional service and synthetic cases. No live government connection.');
  expect(html).toContain('خدمة افتراضية وحالات اختبار مصطنعة. لا يوجد اتصال مباشر بنظام حكومي.');
});
it('Marks Arabic name and banner with their language and direction', async () => {
  const html = renderToStaticMarkup(await HomePage());
  expect(html).toContain('<p lang="ar" dir="rtl">ناظر</p>');
  expect(html).toContain('<p lang="ar" dir="rtl">خدمة افتراضية وحالات اختبار مصطنعة. لا يوجد اتصال مباشر بنظام حكومي.</p>');
});

it('keeps the signed out landing card and sign in callback link', async () => {
  const html = renderToStaticMarkup(await HomePage());
  expect(html).toContain('<main class="nz-legal">');
  expect(html).not.toContain('/api/auth/signin');
  expect(html).toContain('class="nz-signin"');
  expect(html).toContain('href="/privacy"');
  expect(html).toContain('href="/terms"');
  expect(fake.runtimeDriver).not.toHaveBeenCalled();
});

it('submits the landing form to Google with the workspace index as the destination', async () => {
  const tree = await HomePage() as { props: { children: Array<{ type?: string; props?: { children?: unknown } }> } };
  const nav = tree.props.children.find((c) => c?.type === 'nav')!;
  const form = (nav.props!.children as Array<{ type?: string; props: { action: () => Promise<void> } }>).find((c) => c?.type === 'form')!;
  await form.props.action();
  expect(fake.signIn).toHaveBeenCalledWith('google', { redirectTo: '/w' });
});

it('shows idle and pending sign in labels in English and Arabic', () => {
  expect(renderToStaticMarkup(<SignInButton />)).toContain('>Sign in<');
  fake.pending = true;
  const html = renderToStaticMarkup(<SignInButton />);
  fake.pending = false;
  expect(html).toContain('Signing you in');
  expect(html).toContain('جار تسجيل الدخول');
  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('aria-live="polite"');
});

it.each([['w', WorkspaceLoading], ['workspace', WorkspaceIdLoading]])('renders the %s loading status in both languages', (_n, Loading) => {
  const html = renderToStaticMarkup(<Loading />);
  expect(html).toContain('role="status"');
  expect(html).toContain('Opening your workspace');
  expect(html).toContain('جار فتح مساحة العمل');
});

it('redirects signed out visitors at the workspace index to the landing page', async () => {
  await expect(WorkspacesPage()).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;replace;/;307;' });
  expect(fake.runtimeDriver).not.toHaveBeenCalled();
});

it.each([HomePage, WorkspacesPage])('redirects a signed in user to their existing workspace', async (Page) => {
  fake.auth.mockResolvedValue({ user: { id: 'session-user' }, memberships: [{ workspaceId: 'stale-session-workspace' }] });
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('nazir.auth_memberships')) {
      expect(params).toEqual(['session-user']);
      return { rows: [{ workspaceId: 'own-workspace', roles: ['viewer'] }] };
    }
    return { rows: [] };
  });
  const driver: TransactionDriver = { transaction: (work) => work({ query } as SqlConnection) };
  fake.runtimeDriver.mockReturnValue(driver);
  await expect(Page()).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;replace;/w/own-workspace;307;' });
  expect(query).not.toHaveBeenCalledWith(expect.stringContaining('nazir.auth_create_workspace'), expect.anything());
});

it.each([HomePage, WorkspacesPage])('creates one workspace for a new signed in user and reuses it on repeat visits', async (Page) => {
  fake.auth.mockResolvedValue({ user: { id: 'session-user' } });
  const memberships: { workspaceId: string; roles: string[] }[] = [];
  const create = vi.fn(() => {
    memberships.push({ workspaceId: 'new-workspace', roles: ['service_owner'] });
    return { rows: [{ workspaceId: 'new-workspace', memberId: 'new-member' }] };
  });
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('nazir.auth_memberships')) return { rows: [...memberships] };
    if (sql.includes('nazir.auth_create_workspace')) {
      expect(params).toEqual(['session-user', 'My workspace']);
      return create();
    }
    // The new owner seeds the Government pack and the sample agent in the same transaction.
    if (sql.includes('nazir.member_roles')) return { rows: [{ role: 'service_owner' }] };
    if (sql.includes('INSERT INTO nazir.agents')) return { rows: [{ id: 'sample-agent' }] };
    return { rows: [] };
  });
  fake.runtimeDriver.mockReturnValue({ transaction: (work) => work({ query } as SqlConnection) } satisfies TransactionDriver);
  for (let visit = 0; visit < 2; visit++) {
    await expect(Page()).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;replace;/w/new-workspace;307;' });
  }
  expect(create).toHaveBeenCalledTimes(1);
  expect(query.mock.calls.filter(([sql]) => sql.includes('nazir.save_agent_settings'))).toHaveLength(1);
});
it.each([
  ['Privacy', PrivacyPage], ['Terms', TermsPage],
] as const)('Shows the %s heading and contact address', (title, Page) => {
  const html = renderToStaticMarkup(<Page />);
  expect(html).toContain(`<h1>${title}</h1>`);
  expect(html).toContain('shanifadhil022@gmail.com');
  expect(html).toContain('Last updated 19 October 2026.');
});

it.each([PrivacyPage, TermsPage])('provides English and Arabic sections with the contact address', (Page) => {
  const html = renderToStaticMarkup(<Page />);
  expect(html).toContain('<section lang="en">');
  expect(html).toContain('<section lang="ar" dir="rtl">');
  expect(html).toContain('mailto:shanifadhil022@gmail.com');
  expect(html).toContain('آخر تحديث 19 أكتوبر 2026.');
});
it('states the current Google, session and test data storage clearly', () => {
  const html = renderToStaticMarkup(<PrivacyPage />);
  for (const text of ['Google account id', 'expire after 30 days', 'workspaces, roles, test runs, conversations, findings and audit events', 'Vercel', 'Neon', 'Do not enter real personal data', 'third party AI providers']) expect(html).toContain(text);
});
it('states the demonstration limits and acceptable use', () => {
  const html = renderToStaticMarkup(<TermsPage />);
  for (const text of ['prototype for demonstration', 'within the tested scope', 'not a certificate', 'Do not attack the service']) expect(html).toContain(text);
});
