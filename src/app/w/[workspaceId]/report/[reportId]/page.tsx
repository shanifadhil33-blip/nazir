import { notFound } from 'next/navigation';
import { MemberShell } from '@/server/shell/member-shell';
import { ReportScreen } from '@/components/shell/report-screen';
import { WorkspaceApp } from '@/components/ocean/workspace-app';
import type { Lang } from '@/components/ocean/copy';

export const dynamic = 'force-dynamic';

/** One check's report, in the same frame as every other screen. The older view stays behind preview=ocean only. */
export default async function CheckReportPage({ params, searchParams }: { params: Promise<{ workspaceId: string; reportId: string }>; searchParams: Promise<{ preview?: string; lang?: string }> }) {
  const { workspaceId, reportId } = await params;
  const query = await searchParams;
  const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
  if (query.preview === 'ocean') return <WorkspaceApp workspaceId={workspaceId} reportId={reportId} preview initialLang={lang} initialRole="viewer" initialScreen="report" shared />;
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) notFound();
  return <MemberShell screen="report" reportIds={[reportId]} workspaceId={workspaceId} lang={lang} pinned={query.lang !== undefined}><ReportScreen workspaceId={workspaceId} initialLang={lang} reportId={reportId} /></MemberShell>;
}
