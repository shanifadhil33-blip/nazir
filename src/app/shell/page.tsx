import { notFound } from 'next/navigation';
import { DocumentLocale } from '@/components/shell/document-locale';
import { ShellHome } from '@/components/shell/home';
import { type HomeFacts, buildHomeView } from '@/components/shell/home-model';
import { rolesForSeat } from '@/components/ocean/model';
import { localeAttrs } from '@/components/shell/locale';
import type { ShellState } from '@/components/shell/state-card';
import type { Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';

export const dynamic = 'force-dynamic';

function langOf(value?: string): Lang {
  return value === 'ar' ? 'ar' : 'en';
}

function seatOf(value?: string): Seat {
  if (value === 'viewer' || value === 'editor' || value === 'supplier' || value === 'owner') return value;
  return 'owner';
}

function stateOf(value?: string): ShellState {
  if (value === 'loading' || value === 'error' || value === 'empty' || value === 'limit' || value === 'offline' || value === 'view') return value;
  return 'ready';
}

export default async function ShellPage({ searchParams }: { searchParams: Promise<{ lang?: string; role?: string; state?: string; variant?: string }> }) {
  // Design preview with made up numbers. It is for building and screenshots, so it is not served in production.
  if (process.env.NODE_ENV === 'production') notFound();
  const query = await searchParams;
  const lang = langOf(query.lang);
  const { dir } = localeAttrs(lang);
  const localeScript = `document.documentElement.lang=${JSON.stringify(lang)};document.documentElement.dir=${JSON.stringify(dir)};`;
  const seat = seatOf(query.role);
  const facts: HomeFacts = query.variant === 'first'
    ? { checks: 0, score: 0, right: 0, toFix: 0, lastAt: null }
    : { checks: 12, score: 82, right: 82, toFix: 3, lastAt: new Date() };
  const view = buildHomeView(rolesForSeat(seat), facts, '');
  return (
    <>
      <script>{localeScript}</script>
      <DocumentLocale lang={lang} />
      <ShellHome lang={lang} seat={seat} state={stateOf(query.state)} view={view} />
    </>
  );
}
