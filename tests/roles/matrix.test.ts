import { expect, it } from 'vitest';
import { actions, can, roles, roleLabels, type Action } from '../../src/server/auth/roles';
// Columns are owner, supplier, reviewer, viewer. Every expected value is explicit.
const expected: Record<Action, boolean[]> = {
  'rule_pack.draft': [true, true, false, false],
  'rule_pack.approve': [true, false, false, false],
  'adapter.write': [false, true, false, false],
  'agent.write': [true, true, false, false],
  'agent_version.write': [true, true, false, false],
  'agent_version.planted_fault': [true, false, false, false],
  'scenario.write': [true, false, true, false],
  'scenario.approve': [true, false, true, false],
  'plan.propose': [true, false, true, false],
  'plan.approve': [true, false, true, false],
  'proposal.create': [false, true, false, false],
  'proposal.decide': [false, false, true, false],
  'finding.read': [true,true,true,true],
  'finding.override': [false, false, true, false],
  'finding.accept': [true, false, true, false],
  'lesson.read': [true, true, true, false],
  'lesson.edit': [true, false, true, false],
  'lesson.confirm_small': [true, false, true, false],
  'lesson.approve_big': [true, false, false, false],
  'release.decide': [true, false, false, false],
  'evidence.read': [true, true, true, false],
  'hidden_scenarios.read': [true, false, true, false],
  'audit.read': [true, true, true, false],
  'comparison.create': [true, false, true, false],
  'comparison.read': [true, true, true, true],
  'run.read': [true, true, true, true],
  'report.create': [true, true, true, false],
  'report.read': [true, true, true, false],
  'report.viewer': [true, true, true, true],
  'agent.chat': [true, true, true, true],
  'mcp.issue': [true, true, true, true],
  'demo.reset': [true, false, false, false],
};
it.each(actions.flatMap((action) => roles.map((role, index) => ({ action, role, allowed: expected[action][index] }))))('$role $action = $allowed', ({ action, role, allowed }) => {
  expect(can([role], action)).toBe(allowed);
});
it('combines roles and denies an empty role set', () => {
  expect(can(['supplier_maintainer', 'quality_reviewer'], 'proposal.create')).toBe(true);
  expect(can(['supplier_maintainer', 'quality_reviewer'], 'proposal.decide')).toBe(true);
  expect(can(['supplier_maintainer', 'quality_reviewer'], 'rule_pack.approve')).toBe(false);
  expect(can(['viewer', 'service_owner'], 'release.decide')).toBe(true);
  for (const action of actions) expect(can([], action)).toBe(false);
  expect(Object.keys(expected)).toEqual(actions);
});
it('provides the four English and Arabic role labels', () => {
  expect(roles.map((role) => roleLabels[role])).toEqual([
    { en: 'Service owner', ar: 'مالك الخدمة' }, { en: 'Supplier maintainer', ar: 'مسؤول صيانة المورّد' },
    { en: 'Service quality reviewer', ar: 'مراجع جودة الخدمة' }, { en: 'Viewer', ar: 'مشاهد' },
  ]);
});
