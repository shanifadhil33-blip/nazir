import { expect, it } from 'vitest';
import { chooseScenarios } from '../../src/server/runner/choose';

it('prefers the library scenario and refuses two library rows for one key', () => {
  const chosen = chooseScenarios([
    { id: 'legacy', stable_key: 'complaint_en', language: 'en', library: false },
    { id: 'library', stable_key: 'complaint_en', language: 'en', library: true },
    { id: 'ar', stable_key: 'complaint_ar', language: 'ar', library: true },
  ]);
  expect(chosen.ids).toEqual(['library', 'ar']);
  expect(chosen.notes).toEqual([{ stable_key: 'complaint_en', language: 'en', id: 'library', skipped: ['legacy'] }]);
  expect(() => chooseScenarios([
    { id: 'a', stable_key: 'complaint_en', language: 'en', library: true },
    { id: 'b', stable_key: 'complaint_en', language: 'en', library: true },
  ])).toThrow(/Ambiguous scenario key complaint_en en/);
});
