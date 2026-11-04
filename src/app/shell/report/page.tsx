import { notFound } from 'next/navigation';
import type { Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { DocumentLocale } from '@/components/shell/document-locale';
import { MorePreview, type MorePreviewState } from '@/components/shell/more-preview';

export const dynamic = 'force-dynamic';

const states: MorePreviewState[] = ['ready', 'done', 'empty', 'loading', 'error'];

export default async function ReportPreviewPage({ searchParams }: { searchParams: Promise<{ lang?: string; role?: string; state?: string }> }) {
  // Design preview with made up numbers. It is for building and screenshots, so it is not served in production.
  if (process.env.NODE_ENV === 'production') notFound();
  const query = await searchParams;
  const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
  const seat: Seat = query.role === 'viewer' || query.role === 'editor' || query.role === 'supplier' ? query.role : 'owner';
  const state = states.find((item) => item === query.state) ?? 'ready';
  return <><DocumentLocale lang={lang} /><MorePreview screen="report" lang={lang} seat={seat} state={state} /></>;
}
