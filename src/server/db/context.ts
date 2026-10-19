import type { SqlConnection, TransactionDriver } from './driver';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validate(value: string) {
  if (!uuid.test(value)) throw new Error('Invalid context UUID');
}
export async function withMember<T>(driver: TransactionDriver, memberId: string, work: (connection: SqlConnection) => Promise<T>): Promise<T> {
  validate(memberId);
  return driver.transaction(async (connection) => {
    await connection.query('SET LOCAL ROLE nazir_app');
    await connection.query("SELECT set_config('app.member_id', $1, true)", [memberId]);
    return work(connection);
  });
}
export async function withWorker<T>(driver: TransactionDriver, workspaceId: string, work: (connection: SqlConnection) => Promise<T>): Promise<T> {
  validate(workspaceId);
  return driver.transaction(async (connection) => {
    await connection.query('SET LOCAL ROLE nazir_worker');
    await connection.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    return work(connection);
  });
}
