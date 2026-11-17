/** The agent map: what your agent can use, with plain risk labels. Built from the SDK inventory (or the demo sample). */
export type RiskLabel = 'changes_data' | 'outside_content' | 'sends_out' | 'personal_data' | 'wide_access';
export type MapGroup = 'tools' | 'mcp' | 'services' | 'data' | 'permissions';
export type MapItem = { id: string; group: MapGroup; name: string; purpose: string | null; risks: RiskLabel[]; tests: number; testFamilies?: import('./attacks').Family[] };
export type AgentMap = { scope: 'full' | 'replies_only' | 'none'; items: MapItem[]; dangerMix: boolean; skills: string[]; seenAt: string | null };

type Tool = { name?: unknown; description?: unknown; changes_data?: unknown; outside_content?: unknown; sends_out?: unknown; source?: unknown; mcp_server?: unknown; annotations?: { readOnlyHint?: unknown } };
type Inventory = {
  tools?: Tool[];
  mcp_servers?: { name?: unknown; host?: unknown; auth?: unknown; scopes?: unknown; tools?: Tool[] }[];
  services?: { name?: unknown; kind?: unknown; host?: unknown }[];
  data_stores?: { name?: unknown; kind?: unknown; holds?: unknown; access?: unknown }[];
  permissions?: { scope?: unknown }[];
};

const str = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const sendsByName = /email|mail|sms|send|webhook|http|post|notify|message/i;
const outsideByName = /attachment|file|document|web|browse|fetch|search|rag|retriev|email_read|inbox/i;
const personal = /personal|pii|people|person|customer|patient|student|resident|cases?|identity/i;
const writeScope = /write|admin|delete|manage|send|\*/i;

/** Risk labels from design 8, read only from what the agent declares. */
export function toolRisks(tool: Tool): RiskLabel[] {
  const name = str(tool.name) ?? '';
  const risks: RiskLabel[] = [];
  const mcpWrites = tool.source === 'mcp' && tool.annotations?.readOnlyHint !== true && tool.changes_data !== false;
  if (tool.changes_data === true || mcpWrites) risks.push('changes_data');
  if (tool.outside_content === true || (tool.outside_content === undefined && outsideByName.test(name))) risks.push('outside_content');
  if (tool.sends_out === true || (tool.sends_out === undefined && sendsByName.test(name))) risks.push('sends_out');
  return risks;
}

export function mapFromInventory(inventory: Inventory, seenAt: string | null, aimed: (item: MapItem) => number = () => 0): AgentMap {
  const items: MapItem[] = [];
  for (const t of inventory.tools ?? []) {
    const name = str(t.name); if (!name) continue;
    items.push({ id: `tool:${name}`, group: 'tools', name, purpose: str(t.description, 200), risks: toolRisks(t), tests: 0 });
  }
  for (const m of inventory.mcp_servers ?? []) {
    const name = str(m.name); if (!name) continue;
    const scopes = Array.isArray(m.scopes) ? m.scopes.filter((s): s is string => typeof s === 'string') : [];
    const risks = new Set<RiskLabel>((m.tools ?? []).flatMap((t) => toolRisks({ ...t, source: 'mcp' })));
    if (scopes.some((s) => writeScope.test(s) && !/read/i.test(s))) risks.add('wide_access');
    items.push({ id: `mcp:${name}`, group: 'mcp', name, purpose: str(m.host), risks: [...risks], tests: 0 });
  }
  for (const s of inventory.services ?? []) {
    const name = str(s.name); if (!name) continue;
    items.push({ id: `service:${name}`, group: 'services', name, purpose: str(s.kind), risks: [], tests: 0 });
  }
  for (const d of inventory.data_stores ?? []) {
    const name = str(d.name); if (!name) continue;
    const holds = Array.isArray(d.holds) ? d.holds.filter((h): h is string => typeof h === 'string') : [];
    const risks: RiskLabel[] = holds.some((h) => personal.test(h)) ? ['personal_data'] : [];
    if (d.access === 'read_write') risks.push('changes_data');
    items.push({ id: `data:${name}`, group: 'data', name, purpose: holds.length ? holds.join(', ') : str(d.kind), risks, tests: 0 });
  }
  const scopes = (inventory.permissions ?? []).map((p) => str(p.scope)).filter((s): s is string => Boolean(s));
  const writes = new Set(scopes.filter((s) => writeScope.test(s)).map((s) => s.split(':')[0]));
  for (const scope of scopes) items.push({ id: `perm:${scope}`, group: 'permissions', name: scope, purpose: null, risks: writes.size > 1 && writeScope.test(scope) ? ['wide_access'] : [], tests: 0 });
  for (const item of items) item.tests = aimed(item);
  const has = (r: RiskLabel) => items.some((i) => i.risks.includes(r));
  return { scope: 'full', items, dangerMix: has('personal_data') && has('outside_content') && has('sends_out'), skills: [], seenAt };
}

/** City Help Desk, the demo sample agent. Its weaknesses are planted on purpose. */
export const demoInventory: Inventory = {
  tools: [
    { name: 'create_case', description: 'Files a complaint as a new case.', changes_data: true, outside_content: false, sends_out: false },
    { name: 'lookup_case', description: 'Reads a case and the person it belongs to.', changes_data: false, outside_content: false, sends_out: false },
    { name: 'request_human_review', description: 'Sends a case to a person for review.', changes_data: true, outside_content: false, sends_out: false },
    { name: 'read_attachment', description: 'Reads a file the person shares.', changes_data: false, outside_content: true, sends_out: false },
    { name: 'send_email', description: 'Emails an update about a case.', changes_data: false, outside_content: false, sends_out: true },
  ],
  data_stores: [{ name: 'cases', kind: 'database', holds: ['cases', 'personal_data'], access: 'read_write' }],
  services: [{ name: 'City case system', kind: 'http_api' }],
  permissions: [{ scope: 'cases:write' }, { scope: 'email:send' }],
};

export function emptyMap(scope: 'replies_only' | 'none', skills: string[] = []): AgentMap {
  return { scope, items: [], dangerMix: false, skills, seenAt: null };
}
