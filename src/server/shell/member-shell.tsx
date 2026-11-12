import 'server-only';

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import type { Lang } from '@/components/ocean/copy';
import { MemberSnapshotProvider, type MemberSnapshot } from '@/components/shell/member-snapshot';
import { Unauthorized } from '@/server/http/errors';
import { loadMemberSnapshot } from './member-data';

export async function MemberShell({ workspaceId, lang, pinned, withReports = true, withFixes = false, withActive = false, children }: {
  workspaceId: string; lang: Lang; pinned: boolean; withReports?: boolean; withFixes?: boolean; withActive?: boolean; children: ReactNode;
}) {
  let value: MemberSnapshot | undefined;
  try {
    value = await loadMemberSnapshot(workspaceId, lang, pinned, withReports, withFixes, withActive);
  } catch (error) {
    if (error instanceof Unauthorized) redirect('/signin');
    // Preserve the existing client error/retry path if first-paint reads fail.
  }
  return <MemberSnapshotProvider key={workspaceId} value={value}>{children}</MemberSnapshotProvider>;
}
