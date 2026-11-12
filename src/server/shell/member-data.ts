import 'server-only';

import { requireUser } from '@/server/auth/session';
import { runtimeDriver } from '@/server/db/runtime';
import { Forbidden } from '@/server/http/errors';
import { listReports } from '@/server/reports/read';
import { listProposals } from '@/server/repair/list';
import { readAgentSettings } from '@/server/settings/agent-settings';
import type { Lang } from '@/components/ocean/copy';
import type { MemberSnapshot } from '@/components/shell/member-snapshot';
import { initialsOf } from '@/components/shell/people';
import { activeRuns } from '@/server/runner/runs';

/** Request-local data only. Use the same RLS services as the member APIs. */
export async function loadMemberSnapshot(workspaceId: string, lang: Lang, pinned: boolean, withReports: boolean, withFixes = false, withActive = false): Promise<MemberSnapshot> {
  const session = await requireUser();
  const member = session.memberships.find((item) => item.workspaceId === workspaceId);
  if (!member) throw new Forbidden();
  const driver = runtimeDriver();
  const [settings, list, shared, active] = await Promise.all([
    readAgentSettings(driver, member.memberId).catch(() => null),
    withReports ? listReports(driver, member.memberId) : null,
    withFixes ? listProposals(driver, member.memberId).catch(() => null) : null,
    withActive ? activeRuns(driver, member.memberId).catch(() => null) : null,
  ]);
  const name = session.user.name?.trim() ?? '';
  return {
    workspaceId, lang: !pinned && settings?.language ? settings.language : lang,
    roles: member.roles, assistant: settings?.name || member.workspaceName,
    fullName: name, person: name ? { name: name.split(/\s+/)[0]!, initials: initialsOf(name) } : undefined,
    // Pass only the settings the shell uses across the server/client boundary.
    settings: settings ? { name: settings.name, language: settings.language, focus_pack: settings.focus_pack } : null,
    reports: list?.reports ?? [], fixes: shared?.proposals ?? [],
    ...(withActive ? { activeRuns: active ? active.runs.map((run) => ({ runId: run.run_id, done: run.tries_done, total: run.tries_total })) : null } : {}),
  };
}
