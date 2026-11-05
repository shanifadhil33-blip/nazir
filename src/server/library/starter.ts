import 'server-only';
import { demoRulePack, hash } from '../../sandbox/demo-rule-pack';
import { requireRole } from '../auth/guard';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { loadPackCases } from '../packs/load';

/**
 * Installs the shipped Government tests and rules, approved, into a workspace that has none, so its first Quick check can start.
 * Only a service owner can cause it. It does nothing once the workspace has approved tests, so calling it twice is safe.
 * Returns how many tests were added.
 */
export async function ensureStarterLibrary(driver: TransactionDriver, memberId: string): Promise<number> {
  const library = await loadPackCases('government');
  const items = library.flatMap((file) => file.meanings.flatMap((meaning) => meaning.scenarios.map((s) => ({
    family: file.family,
    canonical: { ...meaning.canonical, meaning_key: meaning.meaning_key, kind: meaning.kind, content_hash: hash(meaning) },
    stable_key: s.stable_key, language: s.language, split: s.split,
    persona: { ...s.persona, resident_turns: s.resident_turns }, starting_state: s.starting_state,
    allowed_actions: s.allowed_actions, forbidden_actions: s.forbidden_actions, expected_state: s.expected_state,
    source_clause: s.source_clause, expectation_kind: s.expectation_kind, severity: s.severity, rubric_version: s.rubric_version,
    resident_turns: s.resident_turns, checks: s.checks, library_hash: hash(s),
  }))));
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'scenario.write');
    const me = (await sql.query<{ id: string; wid: string }>('SELECT nazir.current_member_id() AS id, nazir.current_workspace_id() AS wid')).rows[0]!;
    if (!(await sql.query<{ owner: boolean }>("SELECT nazir.member_has_role('service_owner') AS owner")).rows[0]!.owner) return 0;
    if ((await sql.query("SELECT 1 FROM nazir.scenarios WHERE status='approved' LIMIT 1")).rows.length) return 0;
    await sql.query('SET LOCAL ROLE nazir_worker');
    await sql.query("SELECT set_config('app.workspace_id',$1,true)", [me.wid]);
    return Number((await sql.query<{ n: number }>('SELECT nazir.worker_install_starter($1,$2::jsonb,$3::jsonb) AS n', [me.id, JSON.stringify(demoRulePack), JSON.stringify(items)])).rows[0]!.n);
  });
}
