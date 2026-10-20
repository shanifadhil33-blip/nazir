export type ScenarioChoice = { id: string; stable_key: string; language: string; library: boolean };
export type ChoiceNote = { stable_key: string; language: string; id: string; skipped: string[] };

/** One scenario per stable key and language. A library row wins. Two library rows for one key are refused. */
export function chooseScenarios(rows: ScenarioChoice[]) {
  const groups = new Map<string, ScenarioChoice[]>();
  for (const row of rows) {
    const key = `${row.stable_key}\0${row.language}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const ids: string[] = [];
  const notes: ChoiceNote[] = [];
  for (const list of groups.values()) {
    const library = list.filter((row) => row.library);
    const pool = library.length ? library : list;
    const first = pool[0]!;
    if (pool.length > 1) throw new Error(`Ambiguous scenario key ${first.stable_key} ${first.language}`);
    ids.push(first.id);
    const skipped = list.filter((row) => row.id !== first.id).map((row) => row.id);
    if (skipped.length) notes.push({ stable_key: first.stable_key, language: first.language, id: first.id, skipped });
  }
  return { ids, notes };
}
