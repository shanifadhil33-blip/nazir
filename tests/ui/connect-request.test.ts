import { expect, it } from 'vitest';
import { connectHref, connectHomeHref } from '../../src/components/shell/connect-request';

it('keeps the language the person sees on both connect choices and on Back', () => {
  const table = [
    [connectHref('/w/test', 'full', 'en'), '/w/test?connect=full&lang=en'],
    [connectHref('/w/test', 'quick', 'en'), '/w/test?connect=quick&lang=en'],
    [connectHomeHref('/w/test', 'en'), '/w/test?lang=en'],
    [connectHref('/w/test', 'full', 'ar'), '/w/test?connect=full&lang=ar'],
    [connectHref('/w/test', 'quick', 'ar'), '/w/test?connect=quick&lang=ar'],
    [connectHomeHref('/w/test', 'ar'), '/w/test?lang=ar'],
  ];
  for (const [actual, expected] of table) expect(actual).toBe(expected);
});
