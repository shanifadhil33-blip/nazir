import 'server-only';
import { z } from 'zod';
import { can, type Role } from '../auth/roles';
import { requireRole } from '../auth/guard';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded } from '../http/errors';
import { listFindings } from '../findings/read';
import { plannerTools, proposeBoundedPlan, type PlannerTool } from '../planner/bound';

const toolName = z.enum(plannerTools);

export async function listRuns(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'run.read');
    const roles = (await sql.query<{ role: Role }>('SELECT role FROM nazir.member_roles WHERE member_id=nazir.current_member_id()')).rows.map((row) => row.role);
    const evidence = can(roles, 'evidence.read');
    const rows = (await sql.query<Record<string, unknown>>(`SELECT id,status,created_at,calls_used,calls_budget,plan_id${evidence ? ',frozen_manifest' : ''} FROM nazir.runs ORDER BY created_at DESC,id LIMIT 50`)).rows;
    return rows;
  });
}

/** The only tools the in app agent and the MCP connector may run. Unknown names are refused. */
export async function runPlannerTool(driver: TransactionDriver, memberId: string, name: string, args: unknown) {
  const parsed = toolName.safeParse(name);
  if (!parsed.success) throw new Coded(403, 'widens_tools', 'A plan cannot add tools.');
  const tool: PlannerTool = parsed.data;
  if (tool === 'list_runs') return listRuns(driver, memberId);
  if (tool === 'list_findings') return listFindings(driver, memberId, {});
  return proposeBoundedPlan(driver, memberId, args);
}
