'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Lang } from '@/components/ocean/copy';
import type { ReportBody } from '@/server/reports/build';
import type { ServerFix } from './fixes-model';
import type { ExternalView } from '@/server/settings/external-agent';
import type { DemoProgress } from '@/server/shell/demo-progress';
import type { ActivityPage } from '@/server/shell/history';
import type { RunProgress } from './checks-run';
import type { AgentMap } from '@/server/safety/map';

export type SavedReport = { id: string; created_at: string; body: ReportBody };
export type LoadedSettings = { name?: string | null; language?: Lang; my_language?: Lang | null; focus_pack?: string } | null;
export type MemberSnapshot = {
  workspaceId: string;
  lang: Lang;
  roles: string[];
  kind?: 'real' | 'demo';
  connection?: ExternalView | null;
  assistant: string;
  person: { initials: string; name: string } | undefined;
  fullName: string;
  settings: LoadedSettings;
  reports: SavedReport[];
  fixes: ServerFix[];
  /** Null or absent means the active list is unknown, never confirmed empty. */
  activeRuns?: RunProgress[] | null;
  history?: ActivityPage | null;
  /** Present only when the map screen requested its safe first-paint projection. */
  agentMap?: AgentMap | null;
  demoProgress?: DemoProgress | null;
};
const Snapshot = createContext<MemberSnapshot | undefined>(undefined);
export function MemberSnapshotProvider({ value, children }: { value?: MemberSnapshot; children: ReactNode }) {
  return <Snapshot.Provider value={value}>{children}</Snapshot.Provider>;
}
export function useMemberSnapshot(workspaceId: string) {
  const value = useContext(Snapshot);
  return value && (!workspaceId || value.workspaceId === workspaceId) ? value : undefined;
}
