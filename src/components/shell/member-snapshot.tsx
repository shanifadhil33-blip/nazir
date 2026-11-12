'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Lang } from '@/components/ocean/copy';
import type { ReportBody } from '@/server/reports/build';
import type { ServerFix } from './fixes-model';
import type { RunProgress } from './checks-run';

export type SavedReport = { id: string; created_at: string; body: ReportBody };
export type LoadedSettings = { name?: string | null; language?: Lang; focus_pack?: string } | null;
export type MemberSnapshot = {
  workspaceId: string;
  lang: Lang;
  roles: string[];
  assistant: string;
  person: { initials: string; name: string } | undefined;
  fullName: string;
  settings: LoadedSettings;
  reports: SavedReport[];
  fixes: ServerFix[];
  /** Null or absent means the active list is unknown, never confirmed empty. */
  activeRuns?: RunProgress[] | null;
};
const Snapshot = createContext<MemberSnapshot | undefined>(undefined);
export function MemberSnapshotProvider({ value, children }: { value?: MemberSnapshot; children: ReactNode }) {
  return <Snapshot.Provider value={value}>{children}</Snapshot.Provider>;
}
export function useMemberSnapshot(workspaceId: string) {
  const value = useContext(Snapshot);
  return value?.workspaceId === workspaceId ? value : undefined;
}
