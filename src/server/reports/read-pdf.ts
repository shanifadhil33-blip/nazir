import 'server-only';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded, errorLines, Forbidden, NotFound } from '../http/errors';
import { packById } from '../packs/catalog';
import { countsOf, reportRunDate, reportTestTitle, type ReportBody, type ReportConversation } from './build';
import type { PdfExtras } from './pdf';
import { readFullReport } from './read';

/** Full client exports are limited to the two roles allowed to see hidden cases. */
export async function readPdfReport(driver: TransactionDriver, memberId: string, reportId: string, lang: 'en' | 'ar') {
  await withMember(driver, memberId, async (sql) => {
    const { rows } = await sql.query<{ role: string }>('SELECT role FROM nazir.member_roles WHERE member_id=nazir.current_member_id()');
    if (!rows.some((r) => r.role === 'service_owner' || r.role === 'quality_reviewer')) throw new Forbidden();
    // A workspace with no saved report gets the plain first report message, whatever id was asked for.
    if (!(await sql.query('SELECT id FROM nazir.list_reports() LIMIT 1')).rows.length) throw new Coded(404, 'no_report', errorLines.no_report.en);
  });
  const body = await readFullReport(driver, memberId, reportId);
  const extras = await withMember(driver, memberId, async (sql): Promise<Omit<PdfExtras, 'fontBytes'>> => {
    const header = (await sql.query<{ agent_name: string; run_date: string; focus_pack: string | null }>(`SELECT a.name AS agent_name, coalesce(r.started_at,r.created_at)::text AS run_date,
      (SELECT nazir.scenario_pack(s.starting_state) FROM nazir.conversations c JOIN nazir.scenarios s ON s.id=c.scenario_id WHERE c.run_id=r.id ORDER BY c.created_at,c.id LIMIT 1) AS focus_pack
      FROM nazir.runs r JOIN nazir.agent_versions v ON v.id=r.agent_version_id JOIN nazir.agents a ON a.id=v.agent_id WHERE r.id=$1`, [body.run.id])).rows[0];
    if (!header) throw new NotFound();
    const tests = (await sql.query<{ id: string; stable_key: string; expected_state: unknown; canonical: unknown }>(`SELECT c.id,s.stable_key,s.expected_state,m.canonical
      FROM nazir.conversations c JOIN nazir.scenarios s ON s.id=c.scenario_id
      JOIN nazir.scenario_meanings m ON m.id=s.meaning_id WHERE c.run_id=$1`, [body.run.id])).rows;
    // A materialized version proves application. Approval alone does not.
    const repairs = (await sql.query<{ title: string; title_ar: string | null; before_run: string }>(`SELECT coalesce(p.title,f.title) AS title,coalesce(p.title_ar,f.title_ar) AS title_ar,f.run_id AS before_run
      FROM nazir.proposals p JOIN nazir.findings f ON f.id=p.finding_id
      JOIN nazir.runs r ON r.id=$1
      WHERE p.status='approved' AND p.resulting_agent_version_id IS NOT NULL
        AND (p.resulting_agent_version_id=r.agent_version_id OR f.run_id=r.id)
      ORDER BY p.created_at,p.id`, [body.run.id])).rows;
    // An applied repair is not proof that a finding was fixed. Only a passing retest is.
    const fixed = (await sql.query<{ id: string }>("SELECT id FROM nazir.findings WHERE run_id=$1 AND status='retest_passed'", [body.run.id])).rows;
    let beforeRun = repairs.find((r) => r.before_run !== body.run.id)?.before_run;
    if (!beforeRun) {
      beforeRun = (await sql.query<{ id: string }>(`SELECT c.run_a_id AS id FROM nazir.comparisons c
        JOIN nazir.runs a ON a.id=c.run_a_id JOIN nazir.runs b ON b.id=c.run_b_id
        WHERE c.run_b_id=$1 AND a.created_at<b.created_at ORDER BY c.created_at DESC,c.id LIMIT 1`, [body.run.id])).rows[0]?.id;
    }
    const before = beforeRun ? (await sql.query<{ body: ReportBody }>('SELECT body FROM nazir.reports WHERE run_id=$1 ORDER BY created_at DESC,id LIMIT 1', [beforeRun])).rows[0]?.body : null;
    const beforeCounts = before?.counts ?? (beforeRun ? countsOf((await sql.query<ReportConversation>('SELECT id,status,language,scenario_id,attempt_number FROM nazir.conversations WHERE run_id=$1', [beforeRun])).rows, 0) : null);
    const runDate = reportRunDate(header.run_date, lang);
    return {
      lang, agentName: header.agent_name, focusPack: packById(header.focus_pack ?? '')?.name[lang] ?? (lang === 'ar' ? 'غير مسجلة' : 'Not recorded'), runDate,
      testNames: Object.fromEntries(tests.map((t) => [t.id, reportTestTitle(t.stable_key, t.expected_state, t.canonical, lang)])),
      appliedFixes: repairs.map((r) => lang === 'ar' ? r.title_ar || r.title : r.title),
      fixedFindingIds: fixed.map((r) => r.id),
      before: beforeRun && beforeCounts ? { runId: beforeRun, counts: beforeCounts } : null,
    };
  });
  return { body, extras };
}
