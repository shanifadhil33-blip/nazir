import 'server-only';

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import type { Lang } from '@/components/ocean/copy';
import { MemberSnapshotProvider, type MemberSnapshot } from '@/components/shell/member-snapshot';
import { Unauthorized } from '@/server/http/errors';
import { loadMemberSnapshot } from './member-data';

export async function MemberShell({ workspaceId, lang, pinned, withReports = true, withFixes = false, withActive = false, withHistory = false, reportIds = [], reportFix, children }: {
  workspaceId: string; lang: Lang; pinned: boolean; withReports?: boolean; withFixes?: boolean; withActive?: boolean; withHistory?: boolean; reportIds?: string[]; reportFix?: string; children: ReactNode;
}) {
  let value: MemberSnapshot | undefined;
  try {
    value = await loadMemberSnapshot(workspaceId, lang, pinned, withReports, withFixes, withActive, withHistory, reportIds, reportFix);
  } catch (error) {
    if (error instanceof Unauthorized) redirect('/signin');
    // Preserve the existing client error/retry path if first-paint reads fail.
  }
    // Keyed on the language too: switching language in Settings remounts the screens with the new snapshot, no full reload.
  return <MemberSnapshotProvider key={`${workspaceId}:${lang}:${reportFix ?? ''}`} value={value}>{children}</MemberSnapshotProvider>;
}
