import { notFound } from 'next/navigation';
import { MemberShell } from '@/server/shell/member-shell';
import { SafetyReportScreen } from '@/components/shell/safety-report';
import type { Lang } from '@/components/ocean/copy';

export const dynamic = 'force-dynamic';

export default async function SafetyReportPage({ params, searchParams }: { params: Promise<{ workspaceId: string; runId: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { workspaceId, runId } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) notFound();
  const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
  return <MemberShell screen="safety" safetyId={runId} workspaceId={workspaceId} lang={lang} pinned={query.lang !== undefined}><SafetyReportScreen key={runId} workspaceId={workspaceId} runId={runId} initialLang={lang} /></MemberShell>;
}
