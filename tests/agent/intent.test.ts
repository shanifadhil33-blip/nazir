import { expect, it } from 'vitest';
import { actionErrors, claimsDone, exactPlan, exactRepair, failureReply, replyFor, successReply } from '../../src/server/agent/intent';

const id = '11111111-1111-4111-8111-111111111111';

it('reads an exact approval in English or Arabic and ignores a loose request', () => {
  const plan = exactPlan(`I approve plan ${id} and start the run because The bounded plan matches the failure history. I opened the evidence.`);
  expect(plan).toMatchObject({ id, evidence_opened: true });
  expect(plan?.reason.length).toBeGreaterThanOrEqual(10);
  expect(exactPlan(`أوافق على الخطة ${id} وأبدأ التشغيل لأن الخطة ضمن الميزانية وتغطي الأسرة الأفشل. اطلعت على الدليل.`)).toMatchObject({ id });
  expect(exactRepair(`I approve repair ${id} because Read the receipts and the queue before applying. I opened the evidence.`)).toMatchObject({ decision: 'approve', id });
  expect(exactRepair(`أرفض الإصلاح ${id} لأن الدليل لا يكفي لهذا التغيير الآن. اطلعت على الدليل.`)).toMatchObject({ decision: 'reject', id });
  expect(exactRepair('please apply the repair now')).toBeNull();
  expect(exactRepair(`I approve repair ${id} because short. I opened the evidence.`)).toBeNull();
  expect(exactPlan('start the run')).toBeNull();
});
it('never lets a refusal reuse a success sentence', () => {
  for (const kind of Object.keys(failureReply)) {
    const reply = replyFor(kind, false, actionErrors.approval_required);
    expect(claimsDone(reply.en)).toBe(false);
    expect(claimsDone(reply.ar)).toBe(false);
    expect(reply.ar).toMatch(/[\u0600-\u06ff]/);
  }
  expect(() => replyFor('start_run', false, { ...actionErrors.failed, message: successReply.start_run.en })).toThrow(/Unconfirmed success claim/);
  expect(claimsDone(successReply.none.en)).toBe(false);
  expect(claimsDone(successReply.missing.en)).toBe(false);
});

it('a refused plan or unknown kind never mentions a repair decision', () => {
  const plan = replyFor('propose_plan', false, { code: 'failed', message: 'The action was not completed.', ar: 'لم يتم تنفيذ الإجراء.' });
  expect(plan.en.startsWith('No plan was proposed.')).toBe(true);
  expect(plan.ar.startsWith('لم تقترح أي خطة.')).toBe(true);
  expect(replyFor('anything', false).en).toBe('Nothing was changed.');
});

it('every planner refusal code has an Arabic line', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/server/planner/bound.ts', 'utf8');
  const codes = [...src.matchAll(/new Coded\(\d+, '([a-z_]+)'/g)].map((m) => m[1]);
  const listed = Object.values(actionErrors).map((e) => e.code);
  for (const code of codes) expect(listed).toContain(code);
});
