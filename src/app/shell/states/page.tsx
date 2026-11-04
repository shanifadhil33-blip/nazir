import { notFound } from 'next/navigation';
import type { Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { DocumentLocale } from '@/components/shell/document-locale';
import { StatesBoard } from '@/components/shell/states-board';

export const dynamic = 'force-dynamic';

export default async function StatesPreviewPage({ searchParams }: { searchParams: Promise<{ lang?: string; role?: string }> }) {
  // Design preview of the small states. It is for building and screenshots, so it is not served in production.
  if (process.env.NODE_ENV === 'production') notFound();
  const query = await searchParams;
  const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
  const seat: Seat = query.role === 'viewer' || query.role === 'editor' || query.role === 'supplier' ? query.role : 'owner';
  return <><DocumentLocale lang={lang} /><StatesBoard lang={lang} seat={seat} /></>;
}
