import 'server-only';
import { Pool } from '@neondatabase/serverless';
import { poolDriver } from './driver';

let pool: Pool | undefined;
export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error('Database is not configured');
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000, query_timeout: 3000 });
  return pool;
}
export function runtimeDriver() {
  return poolDriver(getPool());
}
export async function databaseHealth(): Promise<'up' | 'down' | 'not_configured'> {
  if (!process.env.DATABASE_URL) return 'not_configured';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getPool().query('SELECT 1'),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Database timeout')), 3000); }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

let inspectionPool: Pool | undefined;
export function inspectionRuntimeDriver() {
  if (!process.env.INSPECT_DATABASE_URL) throw new Error('INSPECT_DATABASE_URL is required for inspection');
  inspectionPool ??= new Pool({ connectionString: process.env.INSPECT_DATABASE_URL, connectionTimeoutMillis: 3000, query_timeout: 3000 });
  return poolDriver(inspectionPool);
}

/** Reserve one session for the entire tick. Never keep a transaction open during model calls. */
export async function runnerLock() {
  const connection = await getPool().connect();
  let held = false;
  try {
    held = (await connection.query<{ held: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('nazir:runner:tick',0)) AS held")).rows[0]?.held === true;
    if (!held) { connection.release(); return null; }
  } catch (error) { connection.release(true); throw error; }
  return async () => {
    try {
      const released = (await connection.query<{ released: boolean }>("SELECT pg_advisory_unlock(hashtextextended('nazir:runner:tick',0)) AS released")).rows[0]?.released;
      connection.release(released ? undefined : true);
    } catch { connection.release(true); }
  };
}
