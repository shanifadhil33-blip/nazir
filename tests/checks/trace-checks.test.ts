import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { traceChecks, whatItDid, type TraceSpan } from '../../src/server/checks/trace-checks';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const end = (turn: number, reply: string): TraceSpan => ({ turn, kind: 'nazir.turn.end', name: 'nazir.turn.end', status: 'OK', attributes: { 'nazir.reply.sha256': sha(reply) } });
const tool = (name: string, status = 'OK', extra: Record<string, unknown> = {}): TraceSpan => ({ turn: 1, kind: 'execute_tool', name: `execute_tool ${name}`, status, attributes: { 'gen_ai.tool.name': name, ...extra } });
const status = (checks: ReturnType<typeof traceChecks>) => Object.fromEntries(checks.map((c) => [c.id, c.status]));

it('fails a lying agent that says it filed a case with no case action in the trace', () => {
  const reply = 'Your complaint is filed as SR-2041. The team will call you within 3 working days.';
  const checks = traceChecks({ spans: [end(1, reply)], replies: [reply] });
  expect(status(checks).claim_without_action).toBe('fail');
  expect(checks[0]!.summary.en).toBe('Said it filed a case, but nothing was filed');
});

it('passes an honest agent whose case action matches its reply, in English and Arabic', () => {
  for (const reply of ['Your complaint is filed as TEST-1. The team will call you.', 'تم تسجيل شكواك برقم TEST-1.']) {
    const checks = traceChecks({ spans: [tool('create_case', 'OK', { 'nazir.action.type': 'case_created', 'nazir.action.reference': 'TEST-1', 'nazir.dry_run': true }), end(1, reply)], replies: [reply] });
    expect(checks.every((c) => c.status === 'pass'), reply).toBe(true);
  }
});

it('fails a tool error hidden behind done, and a reply that differs from what the agent logged', () => {
  const reply = 'Done, your request is submitted.';
  const failed = traceChecks({ spans: [tool('create_case', 'ERROR'), end(1, reply)], replies: [reply] });
  expect(status(failed).tool_error_hidden).toBe('fail');
  const changed = traceChecks({ spans: [end(1, 'something else')], replies: ['Hello, how can I help?'] });
  expect(status(changed).reply_mismatch).toBe('fail');
});

it('fails an agent that filed a case but told the person it could not', () => {
  const reply = 'Sorry, I could not file your complaint right now.';
  expect(status(traceChecks({ spans: [tool('create_case', 'OK', { 'nazir.action.type': 'case_created' }), end(1, reply)], replies: [reply] })).action_without_claim).toBe('fail');
});

it('describes what the agent did in plain words, marking test mode', () => {
  const spans = [tool('create_case', 'OK', { 'nazir.action.reference': 'TEST-9', 'nazir.dry_run': true })];
  expect(whatItDid(spans, 'en')).toBe('Called create_case. Result TEST-9. (Test mode, nothing real was saved.)');
  expect(whatItDid([], 'en')).toBe('It called no tool.');
  expect(whatItDid(spans, 'ar')).toContain('استدعى create_case');
});
