import { fill, type Messages } from '@/components/ocean/copy';
import { rolesForSeat, type Seat } from '@/components/ocean/model';
import { can, type Role } from '@/server/auth/roles';

export type HomeVariant = 'main' | 'first' | 'viewer' | 'quiet';

/** What the person may use, read straight from the server role matrix. */
export type HomeAccess = { start: boolean; fixes: boolean; report: boolean; settings: boolean };

export type HomeFacts = {
  /** Checks run so far. 0 means a first time home. */
  checks: number;
  score: number;
  right: number;
  toFix: number;
  /** When the latest saved report was made. */
  lastAt: Date | null;
};

export type HomeView = {
  variant: HomeVariant;
  access: HomeAccess;
  facts: HomeFacts;
  /** Name of the assistant being checked. */
  assistant: string;
};

const asRoles = (roles: readonly string[]) => roles as Role[];

/** Start follows plan.propose, Fixes follows finding.read, Report follows report.read or report.viewer, Settings follows agent.write. */
export function homeAccess(roles: readonly string[]): HomeAccess {
  const list = asRoles(roles);
  return {
    start: can(list, 'plan.propose'),
    fixes: can(list, 'finding.read'),
    report: can(list, 'report.read') || can(list, 'report.viewer'),
    settings: can(list, 'agent.write'),
  };
}

export function seatAccess(seat: Seat): HomeAccess {
  return homeAccess(rolesForSeat(seat));
}

/** A viewer is read only: the viewer home wins even if checks exist. Nobody who cannot start sees the start button. */
export function homeVariant(access: HomeAccess, roles: readonly string[], checks: number): HomeVariant {
  const readOnly = !roles.some((role) => role !== 'viewer');
  if (readOnly) return 'viewer';
  if (checks === 0) return access.start ? 'first' : 'quiet';
  return 'main';
}

export function buildHomeView(roles: readonly string[], facts: HomeFacts, assistant: string): HomeView {
  const access = homeAccess(roles);
  return { variant: homeVariant(access, roles, facts.checks), access, facts, assistant };
}

export function scoreWord(score: number, copy: Messages): string {
  if (score >= 90) return copy.shell.safe;
  if (score >= 70) return copy.shell.mostlySafe;
  if (score >= 40) return copy.shell.needsCare;
  return copy.shell.notSafeYet;
}

export function headingFor(view: HomeView, copy: Messages): { light: string; bold: string } {
  const hasChecks = view.facts.checks > 0;
  if (hasChecks && view.variant !== 'first') return { light: copy.shell.assistantIs, bold: scoreWord(view.facts.score, copy) };
  if (view.variant === 'first') return { light: copy.shell.letsCheck, bold: copy.shell.yourAssistantBold };
  return { light: copy.shell.assistantLine, bold: copy.shell.noChecksBold };
}

/** Whole days between two moments, by calendar day in Dubai, never negative. */
export function daysBetween(then: Date, now: Date): number {
  const day = (value: Date) => Math.floor((value.getTime() + 4 * 3600_000) / 86_400_000);
  return Math.max(0, day(now) - day(then));
}

export function lastCheckText(at: Date | null, now: Date, copy: Messages): string {
  if (!at) return copy.shell.noChecksYet;
  const days = daysBetween(at, now);
  if (days === 0) return copy.shell.today;
  if (days === 1) return copy.shell.yesterday;
  return fill(copy.shell.daysAgo, { n: String(days) });
}

export type HomeLinks = { start: string; fixes: string; report: string; settings: string; checks: string; more: string; home: string; after: string; history: string; editor: string };

/** Where each tap goes for one workspace. */
export function homeLinks(workspaceId: string): HomeLinks {
  const base = `/w/${workspaceId}`;
  return {
    home: base,
    start: `${base}?screen=checks&start=1`,
    checks: `${base}?screen=checks`,
    fixes: `${base}?screen=failures`,
    after: `${base}?screen=after`,
    report: `${base}/report`,
    settings: `${base}?screen=settings`,
    editor: `${base}?screen=chat&settings=open`,
    history: `${base}?screen=history`,
    more: `${base}?screen=history`,
  };
}
