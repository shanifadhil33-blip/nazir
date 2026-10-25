import { sandboxIdentifier } from '../../server/db/context';
import type { TransactionDriver } from '../../server/db/driver';

export type SchoolRequest = { reference: string; guardian_key: string; kind: string; student_key: string | null; grade: number | null; queue: string; status: string; seeded: boolean };
export type SchoolReading = { tenant: string; guardians: { guardian_key: string; name: string; phone: string }[]; students: { student_key: string; name: string; grade: number; guardian_key: string; term_result: string }[]; grades: { grade: number; term_fee_aed: number; seats_left: number }[]; calendar: { event: string; name: string; name_ar: string; on_date: string }[]; requests: SchoolRequest[]; receipts: { tool: string; outcome: 'ok' | 'error'; request?: { arguments?: { student?: string } }; response?: { ok: boolean; data?: Record<string, unknown> & { name?: string } } }[] };

/** Read only snapshot through the inspector role. */
export async function readSchool(driver: TransactionDriver, tenant: string): Promise<SchoolReading> {
  if (!sandboxIdentifier.test(tenant)) throw new Error('Invalid inspection tenant');
  return driver.transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await db.query('SET LOCAL ROLE nazir_inspector');
    await db.query("SELECT set_config('app.inspect_tenant',$1,true)", [tenant]);
    const guardians = (await db.query<SchoolReading['guardians'][number]>('SELECT guardian_key,name,phone FROM sandbox.sc_guardians WHERE tenant=$1 ORDER BY guardian_key', [tenant])).rows;
    const students = (await db.query<SchoolReading['students'][number]>('SELECT student_key,name,grade,guardian_key,term_result FROM sandbox.sc_students WHERE tenant=$1 ORDER BY student_key', [tenant])).rows.map((s) => ({ ...s, grade: Number(s.grade) }));
    const grades = (await db.query<SchoolReading['grades'][number]>('SELECT grade,term_fee_aed,seats_left FROM sandbox.sc_grades WHERE tenant=$1 ORDER BY grade', [tenant])).rows.map((g) => ({ grade: Number(g.grade), term_fee_aed: Number(g.term_fee_aed), seats_left: Number(g.seats_left) }));
    const calendar = (await db.query<SchoolReading['calendar'][number]>("SELECT event,name,name_ar,to_char(on_date,'YYYY-MM-DD') AS on_date FROM sandbox.sc_calendar WHERE tenant=$1 ORDER BY on_date", [tenant])).rows;
    const requests = (await db.query<SchoolRequest>('SELECT reference,guardian_key,kind,student_key,grade,queue,status,seeded FROM sandbox.sc_requests WHERE tenant=$1 ORDER BY created_at,reference', [tenant])).rows.map((r) => ({ ...r, grade: r.grade == null ? null : Number(r.grade) }));
    const receipts = (await db.query<SchoolReading['receipts'][number]>('SELECT tool,outcome,request,response FROM sandbox.tool_receipts WHERE tenant=$1 ORDER BY created_at,id', [tenant])).rows;
    return { tenant, guardians, students, grades, calendar, requests, receipts };
  });
}
