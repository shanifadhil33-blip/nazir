import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { DemoBar } from '../../src/components/shell/demo-bar';
import { DemoGuide } from '../../src/components/shell/demo-guide';
import { MemberSnapshotProvider, type MemberSnapshot } from '../../src/components/shell/member-snapshot';
import { messagesFor } from '../../src/components/ocean/copy';
import { localeHref } from '../../src/components/shell/locale';
const snapshot: MemberSnapshot = { workspaceId: 'w', lang: 'en', roles: [], assistant: '', person: undefined, fullName: '', settings: null, reports: [], fixes: [] };
it('explains the sample in both languages, with an own account link, and never appears in a real account', () => {
  for (const lang of ['en', 'ar'] as const) {
    const view = (kind: 'real' | 'demo') => renderToStaticMarkup(<MemberSnapshotProvider value={{ ...snapshot, kind }}><DemoBar lang={lang} /></MemberSnapshotProvider>);
    expect(view('real')).toBe('');
    const sample = view('demo'); const copy = messagesFor(lang);
    expect(sample).toContain(copy.demo.bar);
    expect(sample).toContain(copy.demo.barOpen);
    expect(sample).toContain(`href="/signin?lang=${lang}"`);
    expect(sample).toContain(copy.settingsScreen.resetDemo);
    expect(sample).not.toMatch(/service owner|reviewer|supplier|viewer/);
  }
});
it('offers the next actual guide action at each stage and keeps pinned languages through shell links', () => {
  for (const lang of ['en', 'ar'] as const) {
    for (let step = 0; step <= 4; step++) {
      const html = renderToStaticMarkup(<DemoGuide lang={lang} home="/w/w" progress={{ step, fixId: 'fix', checkId: 'sample' }} />);
      expect(html).toContain(`lang=${lang}`);
      expect(html).toContain(step === 4 ? '/signin' : step === 3 ? 'screen=after' : step === 2 ? 'screen=failures' : 'screen=checks');
      if (step < 2) expect(html).toContain('check=sample&amp;show=wrong');
    }
    expect(localeHref('/w/w?screen=checks', lang)).toBe(`/w/w?screen=checks&lang=${lang}`);
    expect(localeHref('/w/w?lang=en&screen=history', lang)).toContain(`lang=${lang}`);
  }
});
