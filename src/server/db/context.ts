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

export const sandboxIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export async function withSandbox<T>(driver: TransactionDriver, context: { tenant: string; requesterKey: string }, work: (connection: SqlConnection) => Promise<T>): Promise<T> {
  if (!sandboxIdentifier.test(context.tenant) || !sandboxIdentifier.test(context.requesterKey)) throw new Error('Invalid sandbox context');
  return driver.transaction(async (connection) => {
    await connection.query('SET LOCAL ROLE nazir_sandbox');
    await connection.query("SELECT set_config('app.sandbox_tenant',$1,true),set_config('app.requester_key',$2,true)", [context.tenant, context.requesterKey]);
    return work(connection);
  });
}
