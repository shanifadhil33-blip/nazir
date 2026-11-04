import { notFound } from 'next/navigation';
import type { Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { DocumentLocale } from '@/components/shell/document-locale';
import { FixesPreview, type FixesPreviewState } from '@/components/shell/fixes-preview';

export const dynamic = 'force-dynamic';

const states: FixesPreviewState[] = ['list', 'approved', 'done', 'empty', 'loading', 'error'];

export default async function FixesPreviewPage({ searchParams }: { searchParams: Promise<{ lang?: string; role?: string; state?: string; view?: string }> }) {
  // Design preview with made up fixes. It is for building and screenshots, so it is not served in production.
  if (process.env.NODE_ENV === 'production') notFound();
  const query = await searchParams;
  const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
  const seat: Seat = query.role === 'viewer' || query.role === 'owner' || query.role === 'supplier' ? query.role : 'editor';
  const state = states.find((item) => item === query.state) ?? 'list';
  return <><DocumentLocale lang={lang} /><FixesPreview lang={lang} seat={seat} state={state} view={query.view === 'after' ? 'after' : 'fixes'} /></>;
}
