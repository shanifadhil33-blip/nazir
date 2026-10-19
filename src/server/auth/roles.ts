export const roles = ['service_owner', 'supplier_maintainer', 'quality_reviewer', 'viewer'] as const;
export type Role = typeof roles[number];
export const roleLabels: Record<Role, { en: string; ar: string }> = {
  service_owner: { en: 'Service owner', ar: 'مالك الخدمة' },
  supplier_maintainer: { en: 'Supplier maintainer', ar: 'مسؤول صيانة المورّد' },
  quality_reviewer: { en: 'Service quality reviewer', ar: 'مراجع جودة الخدمة' },
  viewer: { en: 'Viewer', ar: 'مشاهد' },
};
const matrix = {
  'rule_pack.draft': ['service_owner', 'supplier_maintainer'],
  'rule_pack.approve': ['service_owner'],
  'adapter.write': ['supplier_maintainer'],
  'agent.write': ['service_owner', 'supplier_maintainer'],
  'agent_version.write': ['service_owner', 'supplier_maintainer'],
  'agent_version.planted_fault': ['service_owner'],
  'scenario.write': ['service_owner', 'quality_reviewer'],
  'scenario.approve': ['service_owner', 'quality_reviewer'],
  'plan.propose': ['service_owner', 'quality_reviewer'],
  'plan.approve': ['service_owner', 'quality_reviewer'],
  'proposal.create': ['supplier_maintainer'],
  'proposal.decide': ['quality_reviewer'],
  'finding.read': ['service_owner', 'supplier_maintainer', 'quality_reviewer', 'viewer'],
  'finding.override': ['quality_reviewer'],
  'finding.accept': ['service_owner', 'quality_reviewer'],
  'lesson.edit': ['service_owner', 'quality_reviewer'],
  'lesson.confirm_small': ['service_owner', 'quality_reviewer'],
  'lesson.approve_big': ['service_owner'],
  'release.decide': ['service_owner'],
  'evidence.read': ['service_owner', 'supplier_maintainer', 'quality_reviewer'],
  'hidden_scenarios.read': ['service_owner', 'quality_reviewer'],
  'audit.read': ['service_owner', 'supplier_maintainer', 'quality_reviewer'],
} satisfies Record<string, Role[]>;
export type Action = keyof typeof matrix;
export const actions = Object.keys(matrix) as Action[];
export function can(memberRoles: Role[], action: Action): boolean {
  return memberRoles.some((role) => (matrix[action] as readonly Role[]).includes(role));
}
