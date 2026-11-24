import 'server-only';

import { requireUser } from '@/server/auth/session';
import { runtimeDriver } from '@/server/db/runtime';
import { Forbidden } from '@/server/http/errors';
import { listReports } from '@/server/reports/read';
import { listProposals } from '@/server/repair/list';
import { readAgentSettings } from '@/server/settings/agent-settings';
import type { Lang } from '@/components/ocean/copy';
import type { MemberSnapshot } from '@/components/shell/member-snapshot';
import { messagesFor } from '@/components/ocean/copy';
import { readExternalAgent } from '@/server/settings/external-agent';
import { readMyLanguage } from '@/server/settings/language';
import { agentHeader, initialsOf } from '@/components/shell/people';
import { readDemoProgress } from './demo-progress';
import { readHistory } from './history';
import { activeRuns } from '@/server/runner/runs';
import { readAgentMap } from '@/server/safety/read-map';

/** Request-local data only. Use the same RLS services as the member APIs. */
export async function loadMemberSnapshot(workspaceId: string, lang: Lang, pinned: boolean, withReports: boolean, withFixes = false, withActive = false, withHistory = false, reportIds: string[] = [], reportFix?: string, withMap = false): Promise<MemberSnapshot> {
  const session = await requireUser();
  const member = session.memberships.find((item) => item.workspaceId === workspaceId);
  if (!member) throw new Forbidden();
  const driver = runtimeDriver();
  const [settings, list, shared, active, connection, mine, history, demoProgress, agentMap] = await Promise.all([
    readAgentSettings(driver, member.memberId, false).catch(() => null),
    withReports ? listReports(driver, member.memberId, reportIds, reportFix) : null,
    withFixes ? listProposals(driver, member.memberId, reportFix).catch(() => null) : null,
    withActive ? activeRuns(driver, member.memberId).catch(() => null) : null,
    readExternalAgent(driver, member.memberId).catch(() => null),
    pinned ? null : readMyLanguage(driver, member.memberId).catch(() => null),
    withHistory ? readHistory(driver, member.memberId).catch(() => null) : null,
    member.kind === 'demo' ? readDemoProgress(driver, member.memberId).catch(() => null) : null,
    withMap ? readAgentMap(driver, member.memberId, member.kind).catch(() => null) : null,
  ]);
  const name = session.user.name?.trim() ?? '';
  // A language in the address wins, then yours, then the workspace's.
  const displayLang: Lang = pinned ? lang : mine ?? settings?.language ?? lang;
  return {
    workspaceId, lang: displayLang, demoProgress,
    roles: member.roles, kind: member.kind, connection, assistant: agentHeader(member.kind, connection, messagesFor(displayLang)),
    fullName: name, person: name ? { name: name.split(/\s+/)[0]!, initials: initialsOf(name) } : undefined,
    // Pass only the settings the shell uses across the server/client boundary.
    settings: settings ? { name: settings.name, language: settings.language, focus_pack: settings.focus_pack } : null,
    ...(withHistory ? { history } : {}),
    ...(withMap ? { agentMap } : {}),
    reports: list?.reports ?? [], fixes: shared?.proposals ?? [],
    ...(withActive ? { activeRuns: active ? active.runs.map((run) => ({ runId: run.run_id, done: run.tries_done, total: run.tries_total })) : null } : {}),
  };
}
