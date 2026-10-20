import { describe, expect, it } from 'vitest';
import { measure, type MeasureRow } from '@/server/reports/measured';

const row = (o: Partial<MeasureRow>): MeasureRow => ({ registry: 'repair', status: 'passed', language: 'en', stable_key: 'x', records: [{ id: 'case_exists', status: 'pass' }, { id: 'reply_matches_record', status: 'pass' }], semantic: 'pass', calls: 3, has_reading: true, ...o });
const get = (m: ReturnType<typeof measure>, id: string) => m.metrics.find((x) => x.id === id)!;

describe('measured results from saved runs (N25)', () => {
  it('counts each metric with its basis and leaves cancelled runs out of verdict metrics', () => {
    const m = measure([
      row({}),
      row({ language: 'ar' }),
      row({ language: 'ar', status: 'failed', records: [{ id: 'case_exists', status: 'pass' }, { id: 'reply_matches_record', status: 'fail' }], semantic: 'contradicted' }),
      row({ registry: 'planted_wrong_queue', status: 'failed', records: [{ id: 'right_queue', status: 'fail' }], semantic: 'supported' }),
      row({ registry: 'planted_wrong_queue', status: 'passed', semantic: 'unavailable' }),
      row({ status: 'cancelled', records: [], semantic: null, calls: 0, has_reading: false }),
      row({ status: 'inconclusive', records: [], semantic: null, calls: 1, has_reading: true }),
    ]);
    expect(m.conversations).toBe(7);
    expect(get(m, 'planted_detection')).toMatchObject({ value: 50, numerator: 1, denominator: 2 });
    expect(get(m, 'false_alarms')).toMatchObject({ numerator: 1, denominator: 3, value: 33.3 });
    expect(get(m, 'claim_integrity')).toMatchObject({ numerator: 3, denominator: 4 });
    expect(get(m, 'action_correctness')).toMatchObject({ numerator: 4, denominator: 5 });
    expect(get(m, 'language_parity')).toMatchObject({ value: 50, unit: 'points' });
    expect(get(m, 'judge_agreement')).toMatchObject({ numerator: 3, denominator: 4 });
    expect(get(m, 'reliability')).toMatchObject({ numerator: 5, denominator: 7 });
    expect(get(m, 'evidence_completeness')).toMatchObject({ numerator: 5, denominator: 6 });
    expect(get(m, 'cost')).toMatchObject({ numerator: 16, denominator: 6, value: 2.7 });
  });
  it('shows no value rather than a made up one when nothing was measured', () => {
    const m = measure([]);
    expect(m.metrics.every((x) => x.value === null && x.denominator === 0)).toBe(true);
  });
});
