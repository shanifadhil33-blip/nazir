import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hash } from '../../sandbox/demo-rule-pack';
import { inlineCasesSchema } from './schema';
import { loadLibrary } from '../library/load';
import { packById } from './catalog';
/** The frozen cases of a live pack. Government reads the same 48 library files as before, so the import hashes do not change. */
export async function loadPackCases(id = 'government', cwd = process.cwd()) {
  const pack = packById(id);
  if (!pack || pack.status !== 'live') throw new Error('This focus pack cannot run yet.');
  if (pack.cases.source !== 'library') throw new Error('This focus pack cannot run yet.');
  return loadLibrary(join(cwd, pack.cases.directory));
}

/** The 48 cases of a live pack stored inline (Real estate), checked against the pack's own record checks and with content hashes. */
export async function loadInlineCases(id: string, cwd = process.cwd()) {
  const pack = packById(id);
  if (!pack || pack.cases.source !== 'inline') throw new Error('This focus pack has no inline cases.');
  const file = inlineCasesSchema.parse(JSON.parse(await readFile(join(cwd, pack.cases.file), 'utf8')));
  if (file.pack !== pack.id) throw new Error('Cases belong to another pack.');
  const checks = pack.record_checks.map((c) => c.id);
  const keys = new Set<string>();
  for (const c of file.cases) {
    if (keys.has(c.stable_key)) throw new Error('Duplicate case key.'); keys.add(c.stable_key);
    if (c.checks.some((x) => !checks.includes(x))) throw new Error('Unknown record check.');
    if (/[\u0600-\u06ff]/.test(c.resident_turns.join(' ')) !== (c.language === 'ar')) throw new Error('Case text must match its language.');
  }
  for (const lang of ['en', 'ar']) if (file.cases.filter((c) => c.language === lang).length !== 24) throw new Error('Each language needs 24 cases.');
  return file.cases.map((c) => ({ ...c, content_hash: hash(c) }));
}
