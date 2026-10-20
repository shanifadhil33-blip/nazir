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

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ preview?: string; lang?: string; role?: string; screen?: string }> }) {
  const { workspaceId } = await params;
  const query = await searchParams;
  return <WorkspaceApp workspaceId={workspaceId} preview={query.preview === 'ocean'} initialLang={langOf(query.lang)} initialRole={seatOf(query.role)} initialScreen={screenOf(query.screen)} />;
}
