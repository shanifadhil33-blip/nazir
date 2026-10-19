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
