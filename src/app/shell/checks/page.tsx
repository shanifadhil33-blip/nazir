import { notFound } from 'next/navigation';
import type { Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { ChecksPreview } from '@/components/shell/checks-preview';
import { DocumentLocale } from '@/components/shell/document-locale';

export const dynamic = 'force-dynamic';

const states = ['list', 'check', 'running', 'empty', 'loading', 'error', 'limit', 'offline'] as const;

export default async function ChecksPreviewPage({ searchParams }: { searchParams: Promise<{ lang?: string; role?: string; state?: string }> }) {
  // Design preview with made up checks. It is for building and screenshots, so it is not served in production.
  if (process.env.NODE_ENV === 'production') notFound();
  const query = await searchParams;
  const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
  const seat: Seat = query.role === 'viewer' || query.role === 'editor' || query.role === 'supplier' ? query.role : 'owner';
  const state = states.find((item) => item === query.state) ?? 'list';
  return <><DocumentLocale lang={lang} /><ChecksPreview lang={lang} seat={seat} state={state} /></>;
}
