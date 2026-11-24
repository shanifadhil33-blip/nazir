import { MemberShell } from '@/server/shell/member-shell';
import { HomeScreen } from '@/components/shell/home-screen';
import { FixesScreen } from '@/components/shell/fixes-screen';
import { HistoryScreen } from '@/components/shell/history-screen';
import { SettingsScreen } from '@/components/shell/settings-screen';
import { ChecksScreen } from '@/components/shell/checks-screen';
import { AgentMapScreen } from '@/components/shell/agent-map';
import { WorkspaceApp } from '@/components/ocean/workspace-app';
import { redirect } from 'next/navigation';
import type { Lang } from '@/components/ocean/copy';
import type { ScreenId, Seat } from '@/components/ocean/model';

export const dynamic = 'force-dynamic';

function langOf(value?: string): Lang {
  return value === 'ar' ? 'ar' : 'en';
}
function seatOf(value?: string): Seat {
  if (value === 'viewer' || value === 'editor' || value === 'supplier' || value === 'owner') return value;
  return 'owner';
}
function screenOf(value?: string): ScreenId {
  if (value === 'score' || value === 'failures' || value === 'report') return value;
  return 'chat';
}

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ preview?: string; lang?: string; role?: string; screen?: string; settings?: string; setup?: string; item?: string; check?: string; connect?: string; fix?: string; tab?: string; q?: string; show?: string; safety?: string; change?: string; from?: string; run?: string; reset?: string }> }) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const exactFix = query.fix && /^[0-9a-f-]{36}$/i.test(query.fix) ? query.fix : undefined;
  const exactSafety = query.safety && /^[0-9a-f-]{36}$/i.test(query.safety) ? query.safety : undefined;
  // No screen asked for: the home. Every tap on it opens one of the screens below.
  if (query.preview !== 'ocean' && query.screen === undefined) return <MemberShell screen="home" withActive workspaceId={workspaceId} lang={langOf(query.lang)} pinned={query.lang !== undefined} withReports={true} withFixes={false}><HomeScreen key={query.reset} workspaceId={workspaceId} initialLang={langOf(query.lang)} initialConnect={query.connect === 'full' || query.connect === 'quick' ? query.connect : undefined} /></MemberShell>;
  if (query.preview !== 'ocean' && query.screen === 'checks') return <MemberShell screen="checks" safetyId={exactSafety} reportIds={[query.check, query.from].filter((id): id is string => Boolean(id && /^[0-9a-f-]{36}$/i.test(id)))} withActive workspaceId={workspaceId} lang={langOf(query.lang)} pinned={query.lang !== undefined} withReports={true} withFixes={true}><ChecksScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} initialCheck={query.check} initialTab={query.tab === 'safety' ? 'safety' : 'answers'} initialQuestion={query.q} initialRun={query.run} initialChange={query.change === 'fixed' || query.change === 'still' || query.change === 'newly' ? query.change : undefined} initialFrom={query.from} initialFilter={query.show === 'wrong' || query.show === 'right' || query.show === 'unsure' ? query.show : 'all'} initialSafety={exactSafety} /></MemberShell>;
  if (query.preview !== 'ocean' && query.screen === 'failures') return <MemberShell screen="fixes" reportFix={exactFix} workspaceId={workspaceId} lang={langOf(query.lang)} pinned={query.lang !== undefined} withReports={true} withFixes={true}><FixesScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} mode="fixes" fixId={query.fix} /></MemberShell>;
  if (query.preview !== 'ocean' && query.screen === 'history') return <MemberShell screen="history" withHistory workspaceId={workspaceId} lang={langOf(query.lang)} pinned={query.lang !== undefined} withReports={false} withFixes={false}><HistoryScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} /></MemberShell>;
  if (query.preview !== 'ocean' && query.screen === 'settings') return <MemberShell screen="settings" workspaceId={workspaceId} lang={langOf(query.lang)} pinned={query.lang !== undefined} withReports={false} withFixes={false}><SettingsScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} setupPeople={query.setup === 'people'} /></MemberShell>;
  if (query.preview !== 'ocean' && query.screen === 'after') return <MemberShell screen="after" reportFix={exactFix} workspaceId={workspaceId} lang={langOf(query.lang)} pinned={query.lang !== undefined} withReports={true} withFixes={true}><FixesScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} mode="after" fixId={query.fix && /^[0-9a-f-]{36}$/i.test(query.fix) ? query.fix : null} /></MemberShell>;
  if (query.preview !== 'ocean' && query.screen === 'map') return <MemberShell screen="map" workspaceId={workspaceId} lang={langOf(query.lang)} pinned={query.lang !== undefined} withReports={false} withFixes={false}><AgentMapScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} itemId={query.item} /></MemberShell>;
  if (query.preview !== 'ocean') redirect(`/w/${workspaceId}${query.lang ? `?lang=${langOf(query.lang)}` : ''}`);
  return <WorkspaceApp workspaceId={workspaceId} preview initialLang={langOf(query.lang)} initialRole={seatOf(query.role)} initialScreen={screenOf(query.screen)} initialSettingsOpen={query.settings === 'open'} />;
}
