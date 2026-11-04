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
import SignInPage from '../src/app/signin/page';
import WorkspacesPage from '../src/app/w/page';
import PrivacyPage from '../src/app/privacy/page';
import TermsPage from '../src/app/terms/page';

beforeEach(() => {
  fake.auth.mockReset().mockResolvedValue(null);
  fake.runtimeDriver.mockReset();
});

it('shows the landing page without any demo or service banner', async () => {
  const html = renderToStaticMarkup(await HomePage());
  expect(html).toContain('Test your AI assistant');
  expect(html).toContain('before people use it');
  expect(html).not.toContain('Fictional service');
  expect(html).not.toContain('made up service');
  expect(html).toContain('href="/privacy"');
  expect(html).toContain('href="/terms"');
  expect(fake.runtimeDriver).not.toHaveBeenCalled();
});

it('renders the landing page in Arabic from the lang query', async () => {
  const html = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({ lang: 'ar' }) }));
  expect(html).toContain('dir="rtl"');
  expect(html).toContain('اختبر مساعدك الذكي');
  expect(html).toContain('href="/signin?lang=ar"');
});

it('submits the sign in form to Google with the workspace index as the destination', async () => {
  const tree = await SignInPage() as { props: { children: Array<{ props?: { action?: () => Promise<void> } }> } };
  const page = tree.props.children.find((c) => c?.props?.action)!;
  await page.props!.action!();
  expect(fake.signIn).toHaveBeenCalledWith('google', { redirectTo: '/w' });
  expect(fake.runtimeDriver).not.toHaveBeenCalled();
});

it('shows idle and pending Google button labels one language at a time', () => {
  expect(renderToStaticMarkup(<SignInButton />)).toContain('Continue with Google');
  expect(renderToStaticMarkup(<SignInButton lang="ar" />)).toContain('المتابعة عبر Google');
  fake.pending = true;
  const html = renderToStaticMarkup(<SignInButton />);
  const ar = renderToStaticMarkup(<SignInButton lang="ar" />);
  fake.pending = false;
  expect(html).toContain('Signing you in');
  expect(html).not.toContain('Continue with Google');
  expect(ar).toContain('جار تسجيل الدخول');
  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('nz-spin');
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
