import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalTimeNotice, localTimeText } from '../../src/components/shell/local-time-notice';

it('uses the requested local zone with Western digits in both languages', () => {
  for (const lang of ['en', 'ar'] as const) {
    expect(localTimeText('2026-11-24T16:46:00Z', lang, 'America/New_York')).toContain('11:46');
    expect(localTimeText('2026-11-24T16:46:00Z', lang, 'Asia/Dubai')).toContain('20:46');
    expect(localTimeText('2026-11-24T16:46:00Z', lang, 'Asia/Kolkata')).toContain('22:16');
    expect(localTimeText('2026-11-24T16:46:00Z', lang, 'Asia/Dubai')).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
  }
});

it('reserves the server notice without exposing server time as the user local time', () => {
  const html = renderToStaticMarkup(<LocalTimeNotice at="2026-11-24T16:46:00Z" lang="en" template="Available again {time}." />);
  expect(html).toContain('data-ready="false"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('16:46');
  expect(html).not.toContain('data-ready="true"');
});
