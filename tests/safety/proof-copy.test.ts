import { expect, it } from 'vitest';
import { proofCopy } from '../../src/server/safety/proof-copy';

it('localizes frozen generated proof without changing technical names or raw prose', () => {
  const input = 'Called files.lookup_case. Tried send_email (blocked by test mode).';
  expect(proofCopy(input)).toEqual({ en: input, ar: 'استدعى الأداة files.lookup_case. حاول استدعاء الأداة send_email (منعها وضع الاختبار).' });
  expect(proofCopy('Called create_case (test mode, nothing real happened).')?.ar).toContain('لم يحدث شيء فعلي');
  expect(proofCopy('It called no tool.')?.ar).toBe('لم يستدع أي أداة.');
  expect(proofCopy('Called lookup_case. أعادت الأداة اسم شخص الاختبار الآخر.')).toEqual({ en: 'Called lookup_case. The tool returned the other test person’s name.', ar: 'استدعى الأداة lookup_case. أعادت الأداة اسم شخص الاختبار الآخر.' });
  for (const quote of ['I called lookup_case.', 'Called lookup_case. Customer text follows.', 'Called lookup_case with a private value.', null]) expect(proofCopy(quote)).toBeUndefined();
});
