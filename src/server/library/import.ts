import 'server-only';
import { z } from 'zod';
import { hash } from '../../sandbox/demo-rule-pack';
import { requireRole } from '../auth/guard';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Forbidden, NotFound } from '../http/errors';
import { validateLibrary } from './load';
import type { LibraryFamily } from './schema';
/** Import new versions only. Matching content is reused, never updated in place. */
export async function importLibrary(driver: TransactionDriver, memberId: string, values: LibraryFamily[], source: 'authored' | 'generated' = 'authored') {
  const files = validateLibrary(JSON.parse(JSON.stringify(values, (key, value) => key === 'content_hash' ? undefined : value)));
  z.enum(['authored', 'generated']).parse(source);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'scenario.write');
    const ids: string[] = [];
    await sql.query("SELECT pg_advisory_xact_lock(hashtext(nazir.current_workspace_id()::text || ':library'))");
    for (const file of files) for (const meaning of file.meanings) {
      const canonical = { ...meaning.canonical, meaning_key: meaning.meaning_key, kind: meaning.kind, content_hash: hash(meaning) };
      let meaningId = (await sql.query<{ id: string }>('SELECT id FROM nazir.scenario_meanings WHERE canonical=$1::jsonb AND family=$2', [JSON.stringify(canonical), file.family])).rows[0]?.id;
      if (!meaningId) meaningId = (await sql.query<{ id: string }>('INSERT INTO nazir.scenario_meanings(workspace_id,family,canonical) VALUES(nazir.current_workspace_id(),$1,$2::jsonb) RETURNING id', [file.family, JSON.stringify(canonical)])).rows[0]!.id;
      for (const s of meaning.scenarios) {
        const previous = (await sql.query<{ id: string; version: number; library_hash: string; source: string; meaning_id: string }>('SELECT id,version,library_hash,source,meaning_id FROM nazir.scenarios WHERE stable_key=$1 ORDER BY version DESC LIMIT 1', [s.stable_key])).rows[0];
        if (previous?.library_hash === hash(s) && previous.source === source && previous.meaning_id === meaningId) { ids.push(previous.id); continue; }
        const row = (await sql.query<{ id: string }>(`INSERT INTO nazir.scenarios(workspace_id,meaning_id,stable_key,version,family,language,split,persona,starting_state,allowed_actions,forbidden_actions,expected_state,source_clause,expectation_kind,severity,rubric_version,resident_turns,checks,source,library_hash)
          VALUES(nazir.current_workspace_id(),$1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17,$18,$19) RETURNING id`,
        [meaningId, s.stable_key, (previous?.version ?? 0) + 1, s.family, s.language, s.split, JSON.stringify({ ...s.persona, resident_turns: s.resident_turns }), JSON.stringify(s.starting_state), s.allowed_actions, s.forbidden_actions, JSON.stringify(s.expected_state), s.source_clause, s.expectation_kind, s.severity, s.rubric_version, JSON.stringify(s.resident_turns), s.checks, source, hash(s)])).rows[0]!;
        ids.push(row.id);
      }
    }
    await sql.query("SELECT nazir.append_audit('library.import','scenario',null,$1::jsonb)", [JSON.stringify({ count: ids.length, source })]);
    return ids;
  });
}
export async function approveScenario(driver: TransactionDriver, memberId: string, id: string) {
  z.uuid().parse(id);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'scenario.approve');
    const row = (await sql.query('SELECT * FROM nazir.scenarios WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) throw new NotFound();
    if (row.created_by === memberId || row.status !== 'draft') throw new Forbidden();
    const approved = (await sql.query("UPDATE nazir.scenarios SET status='approved',approved_by=nazir.current_member_id(),approved_at=now() WHERE id=$1 RETURNING *", [id])).rows[0]!;
    // A newer approved version replaces older ones, so plans never pick two versions of one scenario (21 Oct 2026).
    const retired = (await sql.query<{ id: string }>("UPDATE nazir.scenarios SET status='retired' WHERE stable_key=$1 AND id<>$2 AND status='approved' AND version<$3 RETURNING id", [row.stable_key, id, row.version])).rows.map((r) => r.id);
    await sql.query("SELECT nazir.append_audit('scenario.approve','scenario',$1,$2::jsonb)", [id, JSON.stringify(retired.length ? { retired } : {})]);
    return approved;
  });
}
export async function readScenarios(driver: TransactionDriver, memberId: string, split: 'development' | 'hidden', approvedOnly = false) {
  z.enum(['development', 'hidden']).parse(split);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, split === 'hidden' ? 'hidden_scenarios.read' : 'evidence.read');
    return (await sql.query(`SELECT s.*,NOT EXISTS(SELECT FROM nazir.library_fix_usage u JOIN nazir.scenario_meanings exposed ON exposed.id=u.meaning_id JOIN nazir.scenario_meanings own ON own.id=s.meaning_id WHERE u.workspace_id=s.workspace_id AND exposed.canonical->>'meaning_key'=own.canonical->>'meaning_key') AS unseen FROM nazir.scenarios s WHERE split=$1 AND ($2::boolean=false OR status='approved') ORDER BY stable_key,version`, [split, approvedOnly])).rows;
  });
}
export async function regressionSuite(driver: TransactionDriver, memberId: string) {
  return [...await readScenarios(driver, memberId, 'development', true), ...await readScenarios(driver, memberId, 'hidden', true)];
}
export async function markUsedForFix(driver: TransactionDriver, memberId: string, scenarioId: string) {
  z.uuid().parse(scenarioId);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'scenario.write');
    const row = (await sql.query<{ meaning_id: string }>('SELECT meaning_id FROM nazir.scenarios WHERE id=$1', [scenarioId])).rows[0];
    if (!row) throw new NotFound();
    await sql.query('INSERT INTO nazir.library_fix_usage(workspace_id,meaning_id,used_by) VALUES(nazir.current_workspace_id(),$1,nazir.current_member_id()) ON CONFLICT DO NOTHING', [row.meaning_id]);
    await sql.query("SELECT nazir.append_audit('scenario.used_for_fix','scenario',$1,'{}')", [scenarioId]);
  });
}
