import { sandboxIdentifier } from '../../server/db/context';
import type { TransactionDriver } from '../../server/db/driver';

export type ClinicSlot = { slot: string; doctor_key: string; doctor: string; clinic: string; on_leave: boolean; day: string; time: string; status: 'open' | 'booked' | 'blocked' };
export type ClinicRequest = { reference: string; patient_key: string; kind: string; slot: string | null; target: string | null; queue: string; status: string; seeded: boolean };
export type ClinicReading = { tenant: string; slots: ClinicSlot[]; doctors: { doctor_key: string; name: string; clinic: string; on_leave: boolean }[]; coverage: { insurer: string; name: string; service: string; covered: boolean; copay_percent: number }[]; fees: { service: string; price_aed: number }[]; patients: { patient_key: string; name: string; phone: string; insurer: string; lab_released: boolean }[]; requests: ClinicRequest[]; receipts: { tool: string; outcome: 'ok' | 'error' }[] };

/** Read only snapshot through the inspector role. Slot status is the seeded status; bookings are requests. */
export async function readClinic(driver: TransactionDriver, tenant: string): Promise<ClinicReading> {
  if (!sandboxIdentifier.test(tenant)) throw new Error('Invalid inspection tenant');
  return driver.transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await db.query('SET LOCAL ROLE nazir_inspector');
    await db.query("SELECT set_config('app.inspect_tenant',$1,true)", [tenant]);
    const slots = (await db.query<ClinicSlot>('SELECT s.slot,s.doctor_key,d.name AS doctor,d.clinic,d.on_leave,s.day,s.time,s.status FROM sandbox.cl_slots s JOIN sandbox.cl_doctors d ON d.tenant=s.tenant AND d.doctor_key=s.doctor_key WHERE s.tenant=$1 ORDER BY s.slot', [tenant])).rows;
    const doctors = (await db.query<ClinicReading['doctors'][number]>('SELECT doctor_key,name,clinic,on_leave FROM sandbox.cl_doctors WHERE tenant=$1 ORDER BY doctor_key', [tenant])).rows;
    const coverage = (await db.query<ClinicReading['coverage'][number]>('SELECT insurer,name,service,covered,copay_percent FROM sandbox.cl_insurers WHERE tenant=$1 ORDER BY insurer,service', [tenant])).rows.map((c) => ({ ...c, copay_percent: Number(c.copay_percent) }));
    const fees = (await db.query<{ service: string; price_aed: number }>('SELECT service,price_aed FROM sandbox.cl_fees WHERE tenant=$1 ORDER BY service', [tenant])).rows.map((f) => ({ ...f, price_aed: Number(f.price_aed) }));
    const patients = (await db.query<ClinicReading['patients'][number]>('SELECT patient_key,name,phone,insurer,lab_released FROM sandbox.cl_patients WHERE tenant=$1 ORDER BY patient_key', [tenant])).rows;
    const requests = (await db.query<ClinicRequest>('SELECT reference,patient_key,kind,slot,target,queue,status,seeded FROM sandbox.cl_requests WHERE tenant=$1 ORDER BY created_at,reference', [tenant])).rows;
    const receipts = (await db.query<{ tool: string; outcome: 'ok' | 'error' }>('SELECT tool,outcome FROM sandbox.tool_receipts WHERE tenant=$1 ORDER BY created_at,id', [tenant])).rows;
    return { tenant, slots, doctors, coverage, fees, patients, requests, receipts };
  });
}
