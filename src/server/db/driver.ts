/** A single reserved connection. Implemented by Neon and the in memory test database. */
export interface SqlConnection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface TransactionDriver {
  transaction<T>(work: (connection: SqlConnection) => Promise<T>): Promise<T>;
}
export function poolDriver(pool: { connect(): Promise<SqlConnection & { release(): void }> }): TransactionDriver {
  return {
    async transaction(work) {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const result = await work(connection);
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        try { await connection.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
