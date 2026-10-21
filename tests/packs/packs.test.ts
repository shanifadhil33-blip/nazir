import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { loadLibrary } from '../../src/server/library/load';
import { loadPackCases } from '../../src/server/packs/load';
import { focusPacks, livePackIds, packById, packSummary } from '../../src/server/packs/catalog';
import { packIds } from '../../src/server/packs/schema';
import { checkIds } from '../../src/server/checks/record-checks';
import { buildJudgeInput, judgePromptHash, rubric, rubricVersion } from '../../src/server/judge/rubric';
import { hash } from '../../src/sandbox/demo-rule-pack';

it('ports Government with no change: the same 48 frozen cases and hashes as the library', async () => {
  const before = await loadLibrary();
  const after = await loadPackCases('government');
  expect(after).toEqual(before);
  const scenarios = after.flatMap((f) => f.meanings.flatMap((m) => m.scenarios));
  expect(scenarios).toHaveLength(48);
  expect(scenarios.filter((s) => s.language === 'en')).toHaveLength(24);
  expect(hash(after)).toBe(hash(before));
});

it('keeps the judge rubric, its version and its prompt hash exactly as before', () => {
  const gov = packById('government')!;
  expect(gov.judge.rubric).toBe(rubric);
  expect(gov.judge.rubric_version).toBe(rubricVersion);
  expect(judgePromptHash).toBe(hash({ rubricVersion: 'n13.1', rubric: gov.judge.rubric }));
  expect(gov.record_checks.map((c) => c.id)).toEqual([...checkIds]);
});

it('adds the knowledge block only when something matched', () => {
  const scenario = { id: 's', stable_key: 'k', language: 'en', content_hash: 'h', persona: { requester_key: 'saeed', resident_turns: ['What is the fee?'] }, expected_state: {}, source_clause: '3.1' };
  const reading = { tenant: 't', cases: [], receipts: [] } as never;
  const plain = buildJudgeInput({ scenario, reply: 'ok reply', reading });
  expect(buildJudgeInput({ scenario, reply: 'ok reply', reading, knowledge: [] }).prompt).toBe(plain.prompt);
  const cited = buildJudgeInput({ scenario, reply: 'ok reply', reading, knowledge: [{ cite: 1, title: 'Fees', excerpt: 'Permit fee is 200 AED.' }] });
  expect(cited.prompt).toContain('UNTRUSTED KNOWLEDGE BEGIN');
  expect(cited.prompt).toContain('Permit fee is 200 AED.');
  expect(plain.prompt).not.toContain('KNOWLEDGE');
});

it('lists every focus pack as data; only Government is live, drafts cannot load', async () => {
  expect(focusPacks.map((p) => p.id).every((id) => (packIds as readonly string[]).includes(id))).toBe(true);
  expect(livePackIds).toEqual(['government']);
  await expect(loadPackCases('real_estate')).rejects.toThrow();
  expect(packSummary(packById('government')!)).toEqual({ id: 'government', version: '1.0.0', name: expect.any(Object), summary: expect.any(Object), cases: 48, record_checks: 7, refusal_policies: 3, compliance: 5 });
  expect(JSON.stringify(packSummary(packById('government')!))).not.toContain(rubric);
});

it('drafts the Real estate pack: 48 synthetic cases, 24 per language, twins match, Arabic is Arabic', async () => {
  const pack = packById('real_estate')!;
  expect(pack.status).toBe('draft');
  const file = JSON.parse(await readFile('src/server/packs/real-estate/cases.json', 'utf8')) as { synthetic_data: boolean; cases: { stable_key: string; family: string; kind: string; language: string; persona: { synthetic: boolean }; resident_turns: string[]; checks: string[] }[] };
  expect(file.synthetic_data).toBe(true);
  expect(file.cases).toHaveLength(48);
  expect(new Set(file.cases.map((c) => c.stable_key)).size).toBe(48);
  for (const lang of ['en', 'ar']) expect(file.cases.filter((c) => c.language === lang)).toHaveLength(24);
  const families = new Set(file.cases.map((c) => c.family));
  expect(families.size).toBe(12);
  for (const f of families) for (const kind of ['normal', 'trap']) expect(file.cases.filter((c) => c.family === f && c.kind === kind).map((c) => c.language).sort()).toEqual(['ar', 'en']);
  const checks = pack.record_checks.map((c) => c.id);
  for (const c of file.cases) {
    expect(c.persona.synthetic).toBe(true);
    expect(/[\u0600-\u06ff]/.test(c.resident_turns.join(' '))).toBe(c.language === 'ar');
    expect(c.checks.every((id) => checks.includes(id))).toBe(true);
  }
});
