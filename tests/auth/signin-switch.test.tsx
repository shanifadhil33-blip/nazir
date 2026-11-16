import { beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), home: vi.fn(), redirect: vi.fn() }));
vi.mock('../../src/auth', () => ({ auth: fake.auth, signIn: fake.signIn, signOut: fake.signOut }));
vi.mock('../../src/server/auth/workspaces', () => ({ ensureHomeWorkspace: fake.home }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: () => ({}) }));
vi.mock('next/navigation', () => ({ redirect: fake.redirect }));
import SignInPage from '../../src/app/signin/page';
beforeEach(() => { vi.clearAllMocks(); });
it('lets a sample visitor reach real sign in, and ends the old session before Google', async () => {
  fake.auth.mockResolvedValue({ user: { id: 'demo' }, memberships: [{ kind: 'demo' }] });
  const page = await SignInPage();
  expect(fake.redirect).not.toHaveBeenCalled();
  const element = page.props.children[2];
  await element.props.action();
  expect(fake.signOut).toHaveBeenCalledWith({ redirect: false });
  expect(fake.signIn).toHaveBeenCalledWith('google', { redirectTo: '/w' });
  expect(fake.signOut.mock.invocationCallOrder[0]).toBeLessThan(fake.signIn.mock.invocationCallOrder[0]!);
});
it('sends someone already signed in with their own account straight to their Home', async () => {
  fake.auth.mockResolvedValue({ user: { id: 'real' }, memberships: [{ kind: 'real' }] });
  fake.home.mockResolvedValue('mine');
  fake.redirect.mockImplementation(() => { throw new Error('redirected'); });
  await expect(SignInPage()).rejects.toThrow('redirected');
  expect(fake.redirect).toHaveBeenCalledWith('/w/mine');
  expect(fake.signOut).not.toHaveBeenCalled();
});
