import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hash } from '../../sandbox/demo-rule-pack';
import { inlineCasesSchema } from './schema';
import { loadLibrary } from '../library/load';
import { packById } from './catalog';
import { quickCases } from './quick';
/** Government reads its versioned scenario library. */
export async function loadPackCases(id = 'government', cwd = process.cwd()) {
  const pack = packById(id);
  if (!pack || pack.status !== 'live') throw new Error('This focus pack cannot run yet.');
  if (pack.cases.source !== 'library') throw new Error('This focus pack cannot run yet.');
  return loadLibrary(join(cwd, pack.cases.directory));
}

/** Inline cases checked against the pack counts, languages and record checks. */
export async function loadInlineCases(id: string, cwd = process.cwd()) {
  const pack = packById(id);
  if (!pack || pack.cases.source !== 'inline') throw new Error('This focus pack has no inline cases.');
  const file = inlineCasesSchema.parse(JSON.parse(await readFile(join(cwd, pack.cases.file), 'utf8')));
  if (file.pack !== pack.id) throw new Error('Cases belong to another pack.');
  const checks = pack.record_checks.map((c) => c.id);
  const keys = new Set<string>();
  for (const c of file.cases) {
    if (keys.has(c.stable_key)) throw new Error('Duplicate case key.'); keys.add(c.stable_key);
    if (c.stable_key.startsWith('kb_') && (!c.expected.assessment || c.expected.assessment.source.file !== `${pack.id}.md` || c.source_clause !== `verified KB: ${pack.id}.md ${c.stable_key.replace(/^kb_/, '').replace(/_(en|ar)$/, '')}`)) throw new Error('Verified cases need their own pack evidence.');
    if (c.checks.some((x) => !checks.includes(x))) throw new Error('Unknown record check.');
    if (/[\u0600-\u06ff]/.test(c.resident_turns.join(' ')) !== (c.language === 'ar')) throw new Error('Case text must match its language.');
  }
  if (file.cases.length !== pack.cases.count) throw new Error('Case count must match the pack.');
  for (const lang of ['en', 'ar'] as const) if (file.cases.filter((c) => c.language === lang).length !== pack.cases.languages[lang]) throw new Error('Language counts must match the pack.');
  quickCases(pack, file.cases);
  return file.cases.map((c) => ({ ...c, content_hash: hash(c) }));
}
