import { expect, it } from 'vitest';
import { mergeServerFixes, type ServerFix, type StoredFix } from '../../src/components/shell/fixes-model';

const row = (over: Partial<ServerFix> = {}): ServerFix => ({ id: 'p1', finding_id: 'f1', status: 'proposed', title: 'Restore routing', title_ar: 'إعادة التوجيه', created_at: '2026-11-04T08:00:00Z', proposed_by_name: 'Bilal Nasser', decided_at: null, decided_by_name: null, ...over });
const local = (over: Partial<StoredFix> = {}): StoredFix => ({ id: 'p1', findingId: 'f1', status: 'waiting', by: { name: 'Bilal', initials: 'BN', mine: true }, title: { en: 'x', ar: 'y' }, recheck: 3, rerun: true, ...over });

it('shows the shared fixes on a device that has none', () => {
  const merged = mergeServerFixes([], [row(), row({ id: 'p2', status: 'approved', created_at: '2026-11-03T08:00:00Z', decided_at: '2026-11-03T12:00:00Z', decided_by_name: 'Yusuf Haddad' })]);
  expect(merged.map((m) => [m.id, m.status])).toEqual([['p1', 'waiting'], ['p2', 'approved']]);
  expect(merged[1]!.decided).toEqual({ at: '2026-11-03T12:00:00Z', name: 'Yusuf', initials: 'YH', status: 'approved' });
  expect(merged[0]!.by).toEqual({ name: 'Bilal', initials: 'BN', mine: false });
  expect(merged[0]!.title).toEqual({ en: 'Restore routing', ar: 'إعادة التوجيه' });
});
it('takes the status from the server and keeps what only this device knows', () => {
  const merged = mergeServerFixes([local()], [row({ status: 'rejected', decided_at: '2026-11-04T09:00:00Z', decided_by_name: 'Yusuf Haddad' })]);
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ status: 'turnedDown', recheck: 3, rerun: true });
});
it('keeps a fix saved here a moment ago that the list does not have yet', () => {
  const merged = mergeServerFixes([local({ id: 'new', at: '2026-11-05T08:00:00Z' })], [row()]);
  expect(merged.map((m) => m.id)).toEqual(['new', 'p1']);
});
