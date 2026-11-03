import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentVersions } from '../../src/sandbox/versions';
import { demoRulePack } from '../../src/sandbox/demo-rule-pack';
import { clinicVersions } from '../../src/sandbox/clinic/agent';
import { estateVersions } from '../../src/sandbox/real-estate/agent';
import { schoolVersions } from '../../src/sandbox/school/agent';
import { shopVersions } from '../../src/sandbox/shop/agent';
import { clinicPolicy } from '../../src/sandbox/clinic/policy';
import { estatePolicy } from '../../src/sandbox/real-estate/policy';
import { schoolPolicy } from '../../src/sandbox/school/policy';
import { shopPolicy } from '../../src/sandbox/shop/policy';

// Same rules as tests/no-dash.test.ts and tests/no-jargon.test.ts, kept local so those suites are not run twice.
const hasDash = (text: string) => / - |\u2013|\u2014/.test(text);
const banned = ['certified', 'compliant', 'guaranteed', 'fully safe', 'government endorsed'];
const hasJargon = (text: string) => banned.some((w) => new RegExp(String.raw`\b${w.split(' ').join(String.raw`\s+`)}\b`, 'i').test(text));
const root = new URL('../../', import.meta.url).pathname;
const seedMigrations = ['0005_sandbox', '0011_fixtures', '0025_real_estate_sandbox', '0026_pack_runner_shop', '0027_clinic_sandbox', '0028_school_sandbox'];
const femaleNames = ['Fatima', 'Aisha', 'Ayesha', 'Mariam', 'Maryam', 'Sara', 'Sarah', 'Layla', 'Leila', 'Noor', 'Nour', 'Hind', 'Amina', 'Khadija', 'Zainab', 'Huda', 'Salma', 'Reem', 'Rana', 'Dana', 'Lina', 'Mona', 'Amal', 'Latifa', 'Shamma', 'Mozah', 'Yasmin', 'Hala', 'Dina', 'Rania', 'Samira', 'Mrs', 'Ms', 'Miss'];
const femaleArabic = ['فاطمة', 'عائشة', 'مريم', 'سارة', 'ليلى', 'هند', 'أمينة', 'خديجة', 'زينب', 'هدى', 'سلمى', 'لطيفة', 'موزة', 'ياسمين', 'السيدة', 'الآنسة'];
const word = (name: string) => new RegExp(String.raw`(?<![\p{L}\p{N}])${name}(?![\p{L}\p{N}])`, 'u');

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('demo people', () => {
  it('uses male names only in the sandbox seed data', () => {
    for (const name of seedMigrations) {
      const sql = readFileSync(join(root, 'db/migrations', `${name}.sql`), 'utf8');
      for (const female of [...femaleNames, ...femaleArabic]) expect(word(female).test(sql), `${name} has ${female}`).toBe(false);
    }
  });
  it('uses male names only in the library scenarios', () => {
    const dir = join(root, 'src/server/library/scenarios');
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const female of [...femaleNames, ...femaleArabic]) expect(word(female).test(text), `${file} has ${female}`).toBe(false);
    }
  });
});

describe('demo copy', () => {
  const copy = [
    ...Object.values(agentVersions).flatMap((v) => strings(v.disclosure)),
    ...[clinicVersions, estateVersions, schoolVersions, shopVersions].flatMap((set) => Object.values(set).flatMap((v) => strings(v.disclosure))),
    ...[demoRulePack, clinicPolicy, estatePolicy, schoolPolicy, shopPolicy].flatMap((pack) => pack.clauses.flatMap((c) => [c.en, c.ar])),
  ];
  it('has English and Arabic for every disclosure and every clause', () => {
    const versions = [...Object.values(agentVersions), ...[clinicVersions, estateVersions, schoolVersions, shopVersions].flatMap((set) => Object.values(set))];
    for (const v of versions) {
      expect(v.disclosure.en.length, v.id).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(v.disclosure.ar), v.id).toBe(true);
    }
    for (const pack of [demoRulePack, clinicPolicy, estatePolicy, schoolPolicy, shopPolicy]) {
      for (const c of pack.clauses) {
        expect(/[A-Za-z]/.test(c.en), c.id).toBe(true);
        expect(/[؀-ۿ]/.test(c.ar), c.id).toBe(true);
      }
    }
  });
  it('has no dashes and no overclaiming words', () => {
    expect(copy.filter(hasDash)).toEqual([]);
    expect(copy.filter(hasJargon)).toEqual([]);
  });
  it('shows no dash in the resident turns of the library scenarios', () => {
    const dir = join(root, 'src/server/library/scenarios');
    const found = readdirSync(dir).flatMap((file) => strings(JSON.parse(readFileSync(join(dir, file), 'utf8'))).filter(hasDash).map((text) => `${file}: ${text.slice(0, 40)}`));
    expect(found).toEqual([]);
  });
});
