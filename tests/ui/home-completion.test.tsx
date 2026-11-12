import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { assembleReport } from '../../src/server/reports/build';
import { messagesFor } from '../../src/components/ocean/copy';
const data = vi.hoisted(() => ({ reports: [] as unknown[] }));
vi.mock('../../src/components/shell/member-data', () => ({ useMemberData: () => ({ lang: 'en', phase: 'ready', reports: data.reports, roles: ['service_owner'], kind: 'real', connection: { name: 'Sample', ready: true }, assistant: 'Sample · Connected', reload: () => {} }) }));
import { HomeScreen } from '../../src/components/shell/home-screen';
const report = (status: string, second: string) => ({ id: status, created_at: new Date().toISOString(), body: assembleReport({ run: { id: status, status, calls_used: 0, calls_budget: 8 }, conversations: [{ id: 'a', status: 'passed', language: 'en', split: 'development' }, { id: 'b', status: second, language: 'ar', split: 'development' }], findings: [], messages: [] }) });
it('selects the newest completed score even when a stopped check is newer', () => {
  data.reports = [report('cancelled', 'cancelled'), report('failed', 'failed')];
  const html = renderToStaticMarkup(<HomeScreen workspaceId="w" initialLang="en" />);
  expect(html).toContain('Your agent got 1 of 2 answers right');
  expect(html).toContain('check=failed');
  expect(html).not.toContain(messagesFor('en').shell.notSafeYet);
});
it('uses the existing first check state when every saved check is partial', () => {
  data.reports = [report('cancelled', 'cancelled')];
  const html = renderToStaticMarkup(<HomeScreen workspaceId="w" initialLang="en" />);
  expect(html).toContain('data-variant="first"');
  expect(html).not.toContain(messagesFor('en').shell.notSafeYet);
});
