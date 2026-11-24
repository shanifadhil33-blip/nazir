import { expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('../../src/auth', () => mock);
import { signOutAction } from '../../src/app/actions/sign-out';

it('ends the session without a framework redirect so the confirmed busy state can survive until navigation', async () => {
  mock.signOut.mockResolvedValue(undefined);
  await signOutAction();
  expect(mock.signOut).toHaveBeenCalledWith({ redirect: false });
});
