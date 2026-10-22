import 'server-only';
import { quickCases } from '../packs/quick';
import { packById } from '../packs/catalog';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { demoRulePack, hash } from '../../sandbox/demo-rule-pack';
import { toolManifest } from '../../sandbox/tools';
import { checkIds } from '../checks/record-checks';
import { families, familySchema, groups, hiddenFamilies, type LibraryFamily } from './schema';
export function validateLibrary(values: unknown[]) {
  const files = values.map((value) => familySchema.parse(value));
  if (files.length !== families.length || new Set(files.map((f) => f.family)).size !== families.length) throw new Error('Each test family must appear once.');
  const keys = new Set<string>();
  const contents = new Set<string>();
  const remember = (key: string) => { if (keys.has(key)) throw new Error('Duplicate library key.'); keys.add(key); };
  for (const file of files) {
    if (file.group !== groups[Math.floor(families.indexOf(file.family) / 2)]) throw new Error('Wrong family group.');
    if (!file.meanings.some((m) => m.kind === 'normal') || !file.meanings.some((m) => m.kind === 'trap')) throw new Error('Each family needs a normal case and a trap.');
    for (const meaning of file.meanings) {
      remember(meaning.meaning_key);
      const digest = hash(meaning.canonical);
      if (contents.has(digest)) throw new Error('Duplicate meaning content.'); contents.add(digest);
      if (new Set(meaning.scenarios.map((s) => s.language)).size !== 2) throw new Error('A meaning needs both languages.');
      for (const s of meaning.scenarios) {
        remember(s.stable_key);
        const digest = hash({ ...s, stable_key: '' });
        if (contents.has(digest)) throw new Error('Duplicate scenario content.'); contents.add(digest);
        if (s.family !== file.family || s.group !== file.group || s.split !== (hiddenFamilies.includes(file.family) ? 'hidden' : 'development')) throw new Error('The family split must match both twins.');
        if (s.allowed_actions.some((a) => s.forbidden_actions.includes(a))) throw new Error('Actions cannot be allowed and forbidden.');
        const names = toolManifest.map((t) => t.function.name);
        if ([...s.allowed_actions, ...s.forbidden_actions].some((n) => !names.includes(n))) throw new Error('Unknown tool name.');
        if (s.checks.some((id) => !(checkIds as readonly string[]).includes(id))) throw new Error('Unknown record check.');
        if (!demoRulePack.clauses.some((c) => c.id === s.source_clause) && !(s.expectation_kind === 'fictional_demo_rule' && s.source_clause.startsWith('fictional demo rule: '))) throw new Error('Unknown source clause.');
        const arabic = /[\u0600-\u06ff]/.test(s.resident_turns.join(' '));
        if (arabic !== (s.language === 'ar')) throw new Error('Scenario text must match its language.');
      }
    }
  }
  return files;
}
export async function loadLibrary(root = join(process.cwd(), 'src/server/library/scenarios')) {
  const names = (await readdir(root)).filter((n) => n.endsWith('.json')).sort();
  const values = await Promise.all(names.map(async (n) => {
    const value = familySchema.parse(JSON.parse(await readFile(join(root, n), 'utf8')));
    if (n !== value.family + '.json') throw new Error('Library filename must match its family.');
    return value;
  }));
  const files = libraryHashes(validateLibrary(values));
  quickCases(packById('government')!, files.flatMap((f) => f.meanings.flatMap((m) => m.scenarios)));
  return files;
}
export function libraryHashes(files: LibraryFamily[]) {
  return files.map((file) => ({ ...file, meanings: file.meanings.map((m) => ({ ...m, content_hash: hash(m), scenarios: m.scenarios.map((s) => ({ ...s, content_hash: hash(s) })) })) }));
}
