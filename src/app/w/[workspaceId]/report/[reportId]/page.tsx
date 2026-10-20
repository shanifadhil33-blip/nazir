import { WorkspaceApp } from '@/components/ocean/workspace-app';
import type { Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';

export const dynamic = 'force-dynamic';

export default async function SharedReportPage({ params, searchParams }: { params: Promise<{ workspaceId: string; reportId: string }>; searchParams: Promise<{ preview?: string; lang?: string; role?: string }> }) {
  const { workspaceId, reportId } = await params;
  const query = await searchParams;
  const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
  const role: Seat = query.role === 'viewer' || query.role === 'editor' || query.role === 'supplier' || query.role === 'owner' ? query.role : 'viewer';
  return <WorkspaceApp workspaceId={workspaceId} reportId={reportId} preview={query.preview === 'ocean'} initialLang={lang} initialRole={role} initialScreen="report" shared />;
}
