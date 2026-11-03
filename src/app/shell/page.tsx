import { DocumentLocale } from '@/components/shell/document-locale';
import { ShellHome } from '@/components/shell/home';
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
  if (value === 'loading' || value === 'error' || value === 'empty' || value === 'limit') return value;
  return 'ready';
}

export default async function ShellPage({ searchParams }: { searchParams: Promise<{ lang?: string; role?: string; state?: string }> }) {
  const query = await searchParams;
  const lang = langOf(query.lang);
  const { dir } = localeAttrs(lang);
  const localeScript = `document.documentElement.lang=${JSON.stringify(lang)};document.documentElement.dir=${JSON.stringify(dir)};`;
  return (
    <>
      <script>{localeScript}</script>
      <DocumentLocale lang={lang} />
      <ShellHome lang={lang} seat={seatOf(query.role)} state={stateOf(query.state)} />
    </>
  );
}
