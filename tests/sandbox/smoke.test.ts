import { expect, it, vi } from 'vitest';
import { cappedModel } from '../../scripts/sandbox-agent-smoke.mjs';
it('shares a hard MAX_CALLS cap across journeys, including failed calls', async () => {
  const fake = vi.fn().mockResolvedValueOnce({ content: 'English' }).mockRejectedValueOnce(new Error('failure'));
  const cap = cappedModel(fake, 2);
  expect(await cap.model({ messages: [] })).toEqual({ content: 'English' });
  await expect(cap.model({ messages: [] })).rejects.toThrow('failure');
  await expect(cap.model({ messages: [] })).rejects.toThrow('MAX_CALLS reached');
  expect(fake).toHaveBeenCalledTimes(2); expect(cap.calls).toBe(2);
});
it.each([0, -1, 1.5, NaN])('rejects invalid call cap %s', (max) => { expect(() => cappedModel(vi.fn(), max)).toThrow('positive integer'); });
