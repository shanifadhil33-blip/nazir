import { WorkspaceApp } from '@/components/ocean/workspace-app';
import { ReportScreen } from '@/components/shell/report-screen';
import type { Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ preview?: string; lang?: string; role?: string }> }) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
  // The preview flag keeps the older report view for the design pages that still use it.
  if (query.preview !== 'ocean') return <ReportScreen workspaceId={workspaceId} initialLang={lang} />;
  const role: Seat = query.role === 'viewer' || query.role === 'editor' || query.role === 'supplier' || query.role === 'owner' ? query.role : 'owner';
  return <WorkspaceApp workspaceId={workspaceId} preview initialLang={lang} initialRole={role} initialScreen="report" shared />;
}
