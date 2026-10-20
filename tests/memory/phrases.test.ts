import { expect, it } from 'vitest';
import { correctionFrom, hasLastingPhrase } from '../../src/server/memory/phrases';

it('matches a lasting phrase anywhere in the sentence', () => {
  const message = 'Please always test wrong_routing_queue first.';
  expect(message.startsWith('always')).toBe(false);
  expect(hasLastingPhrase(message)).toBe(true);
  expect(correctionFrom(message)?.effect).toEqual({ kind: 'test_first', family: 'wrong_routing_queue' });
  expect(hasLastingPhrase('من فضلك افحص دائما طابور الشكاوى.')).toBe(true);
  expect(correctionFrom('من فضلك افحص دائما طابور الشكاوى.')?.effect).toEqual({ kind: 'check_queue', category: 'complaint', queue: 'complaint_review' });
  expect(hasLastingPhrase('hello')).toBe(false);
  expect(correctionFrom('hello')).toBeNull();
});

it('questions and words that only contain always are not lessons', () => {
  expect(correctionFrom('Why does it always fail?')).toBeNull();
  expect(correctionFrom('لماذا يفشل دائما؟')).toBeNull();
  expect(correctionFrom('Check the hallways queue')).toBeNull();
  expect(correctionFrom('Please check the complaint queue first always')).not.toBeNull();
});
