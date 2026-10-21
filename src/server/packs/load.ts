import 'server-only';
import { join } from 'node:path';
import { loadLibrary } from '../library/load';
import { packById } from './catalog';
/** The frozen cases of a live pack. Government reads the same 48 library files as before, so the import hashes do not change. */
export async function loadPackCases(id = 'government', cwd = process.cwd()) {
  const pack = packById(id);
  if (!pack || pack.status !== 'live') throw new Error('This focus pack cannot run yet.');
  if (pack.cases.source !== 'library') throw new Error('This focus pack cannot run yet.');
  return loadLibrary(join(cwd, pack.cases.directory));
}
