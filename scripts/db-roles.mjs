import { Pool } from '@neondatabase/serverless';

const password = process.env.NAZIR_APP_LOGIN_PASSWORD;
if (!process.env.DATABASE_URL_OWNER || !password) throw new Error('DATABASE_URL_OWNER and NAZIR_APP_LOGIN_PASSWORD required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL_OWNER });
let db;
try {
  db = await pool.connect();
  await db.query('BEGIN');
  await db.query("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nazir_login') THEN CREATE ROLE nazir_login LOGIN NOINHERIT; END IF; END $$");
  // PostgreSQL role DDL does not accept bind parameters. quote_literal handles the password.
  const { rows } = await db.query('SELECT quote_literal($1) AS password', [password]);
  // Managed Postgres (Neon) refuses NOREPLICATION and NOBYPASSRLS from a non superuser, so set only what we may and check the rest.
  await db.query(`ALTER ROLE nazir_login LOGIN NOINHERIT PASSWORD ${rows[0].password}`);
  const attributes = await db.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname='nazir_login'");
  const role = attributes.rows[0];
  if (!role || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls || role.rolinherit) throw new Error('nazir_login has unexpected attributes');
  const memberships = await db.query("SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname='nazir_login'");
  for (const row of memberships.rows) {
    const identifier = '"' + row.rolname.replaceAll('"', '""') + '"';
    await db.query(`REVOKE ${identifier} FROM nazir_login`);
  }
  await db.query('REVOKE ALL ON SCHEMA nazir FROM nazir_login');
  await db.query('REVOKE ALL ON ALL TABLES IN SCHEMA nazir FROM nazir_login');
  await db.query('REVOKE ALL ON ALL SEQUENCES IN SCHEMA nazir FROM nazir_login');
  await db.query('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nazir FROM nazir_login');
  for (const scope of ['SCHEMA sandbox', 'ALL TABLES IN SCHEMA sandbox', 'ALL SEQUENCES IN SCHEMA sandbox', 'ALL FUNCTIONS IN SCHEMA sandbox']) await db.query(`REVOKE ALL ON ${scope} FROM nazir_login`);
  await db.query('GRANT nazir_app,nazir_worker,nazir_sandbox TO nazir_login');
  await db.query('COMMIT');
  console.log('Roles configured');
} catch (error) {
  try { await db?.query('ROLLBACK'); } catch { /* Keep connection errors private. */ }
  console.error('Role setup failed:', String(error?.message ?? error).replace(/postgres(ql)?:\/\/\S+/g, '[address]').replace(/PASSWORD\s+'[^']*'/gi, 'PASSWORD [hidden]'));
  process.exitCode = 1;
} finally {
  db?.release();
  await pool.end();
}
