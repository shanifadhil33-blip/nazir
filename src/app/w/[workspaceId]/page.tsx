import { HomeScreen } from '@/components/shell/home-screen';
import { FixesScreen } from '@/components/shell/fixes-screen';
import { HistoryScreen } from '@/components/shell/history-screen';
import { SettingsScreen } from '@/components/shell/settings-screen';
import { ChecksScreen } from '@/components/shell/checks-screen';
import { WorkspaceApp } from '@/components/ocean/workspace-app';
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

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ preview?: string; lang?: string; role?: string; screen?: string; settings?: string; check?: string }> }) {
  const { workspaceId } = await params;
  const query = await searchParams;
  // No screen asked for: the home. Every tap on it opens one of the screens below.
  if (query.preview !== 'ocean' && query.screen === undefined) return <HomeScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} />;
  if (query.preview !== 'ocean' && query.screen === 'checks') return <ChecksScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} initialCheck={query.check} />;
  if (query.preview !== 'ocean' && query.screen === 'failures') return <FixesScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} mode="fixes" />;
  if (query.preview !== 'ocean' && query.screen === 'history') return <HistoryScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} />;
  if (query.preview !== 'ocean' && query.screen === 'settings') return <SettingsScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} />;
  if (query.preview !== 'ocean' && query.screen === 'after') return <FixesScreen workspaceId={workspaceId} initialLang={langOf(query.lang)} mode="after" />;
  return <WorkspaceApp workspaceId={workspaceId} preview={query.preview === 'ocean'} initialLang={langOf(query.lang)} initialRole={seatOf(query.role)} initialScreen={screenOf(query.screen)} initialSettingsOpen={query.settings === 'open'} />;
}
