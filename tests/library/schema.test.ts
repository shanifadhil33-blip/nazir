import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { loadLibrary, validateLibrary } from '../../src/server/library/load';
import { families, familySchema } from '../../src/server/library/schema';
import { hash, demoRulePack } from '../../src/sandbox/demo-rule-pack';
import { toolManifest } from '../../src/sandbox/tools';
import { checkIds } from '../../src/server/checks/record-checks';
import { demoScenarios } from '../../src/server/runner/demo-scenarios';
const library = await loadLibrary();
for (const family of families) it(`validates ${family} with successful and trap language twins`, () => {
  const file = library.find((f) => f.family === family)!;
  expect(familySchema.safeParse(JSON.parse(JSON.stringify(file, (key, value) => key === 'content_hash' ? undefined : value))).success).toBe(true);
  expect(file.meanings.map((m) => m.kind).sort()).toEqual(['normal', 'trap']);
  for (const m of file.meanings) {
    expect(m.scenarios.map((s) => s.language).sort()).toEqual(['ar', 'en']);
    expect(new Set(m.scenarios.map((s) => s.split)).size).toBe(1);
    for (const s of m.scenarios) {
      expect(/[\u0600-\u06ff]/.test(s.resident_turns.join(' '))).toBe(s.language === 'ar');
      expect([...s.allowed_actions, ...s.forbidden_actions].every((n) => toolManifest.some((t) => t.function.name === n))).toBe(true);
      expect(s.checks.every((id) => (checkIds as readonly string[]).includes(id))).toBe(true);
      expect(demoRulePack.clauses.some((c) => c.id === s.source_clause) || s.source_clause.startsWith('fictional demo rule: ')).toBe(true);
      const { content_hash, ...content } = s;
      expect(content_hash).toBe(hash(content));
    }
  }
});
it('has 12 families, 24 meanings, 48 scenarios, eight development and four hidden families', () => {
  expect(library).toHaveLength(12);
  expect(library.flatMap((f) => f.meanings)).toHaveLength(24);
  expect(library.flatMap((f) => f.meanings.flatMap((m) => m.scenarios))).toHaveLength(48);
  expect(library.filter((f) => f.meanings[0]!.scenarios[0]!.split === 'development')).toHaveLength(8);
  expect(library.filter((f) => f.meanings[0]!.scenarios[0]!.split === 'hidden')).toHaveLength(4);
});
it('pins the canonical whole library digest and repeats hashes across loads', async () => {
  expect(await loadLibrary()).toEqual(library);
  expect(hash(library)).toBe('d360bd58e9e4962b3c1e6d2e03af9962f6edf06f45dff34800c97b24fd55546d');
});
it('retains the exact two demo complaint inputs and hashes', () => {
  const normal = library.find((f) => f.family === 'unresolved_prior_request')!.meanings[0]!;
  for (const s of normal.scenarios) {
    const original = demoScenarios.find((d) => d.language === s.language)!;
    const projection = { stable_key: s.stable_key, language: s.language, requester_key: s.persona.requester_key, resident_turns: s.resident_turns, expected_state: { category: s.expected_state.category, queue: s.expected_state.queue, escalation_queue: s.expected_state.escalation_queue, prior_request_ref: s.expected_state.prior_request_ref, cases: s.expected_state.cases } };
    expect({ ...projection, content_hash: hash(projection) }).toEqual(original);
  }
});
it('keeps every JSON string free of dashes, banned copy and the excluded word', async () => {
  const banned = / - |\u2013|\u2014|\b(?:dispatch|synergy|leverage|orchestrate|orchestration|seamless|robust|empower|unlock|copilot|LLM|guardrails|deterministic|certified|compliant|guaranteed|cutting edge|revolutionary|game changer|AI employee|fully safe|government endorsed|optional)\b/i;
  for (const f of families) expect(await readFile(`src/server/library/scenarios/${f}.json`, 'utf8')).not.toMatch(banned);
});
async function raw() { return Promise.all(families.map(async (f) => JSON.parse(await readFile(`src/server/library/scenarios/${f}.json`, 'utf8')))); }
it('refuses duplicate files, meanings, scenario keys and language twins', async () => {
  const values = await raw();
  expect(() => validateLibrary([...values, values[0]])).toThrow();
  const clone = structuredClone(values); clone[1].meanings[0].meaning_key = clone[0].meanings[0].meaning_key;
  expect(() => validateLibrary(clone)).toThrow(/Duplicate/);
  const same = structuredClone(values); same[0].meanings[0].scenarios[1].language = 'en';
  expect(() => validateLibrary(same)).toThrow(/both languages/);
});
it('refuses mixed splits, unknown tools, check ids, source clauses and unrecognized fields', async () => {
  for (const [field, value] of [['split', 'hidden'], ['allowed_actions', ['made_up_tool']], ['checks', ['made_up_check']], ['source_clause', 'not a clause'], ['extra_field', true]]) {
    const values = await raw(); values[0].meanings[0].scenarios[0][field as string] = value;
    expect(() => validateLibrary(values)).toThrow();
  }
});
