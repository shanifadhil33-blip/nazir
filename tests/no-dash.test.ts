import { describe, expect, it } from 'vitest';
import { visibleCopy, visibleStrings } from './helpers/source';

export function hasDash(text: string): boolean {
  return / - |\u2013|\u2014/.test(text);
}

describe('Copy punctuation', () => {
  it.each(['Plan – draft', 'Plan — draft', 'Plan - draft'])('Rejects %s', (value) => {
    expect(hasDash(value)).toBe(true);
  });
  it.each(['max-w-sm', 'https://a-b.com'])('Allows %s', (value) => {
    expect(hasDash(value)).toBe(false);
  });
  it('Scans visible literals, JSX and template text while allowing code', () => {
    const source = 'import value from "./a-b"; const id = "max-w-sm"; const view = <p className="max-w-sm">Plan – draft</p>; const label = `Plan — ${id}`;';
    expect(visibleStrings(source).filter(hasDash)).toHaveLength(2);
    expect(visibleStrings('<a href="https://a-b.com" className="max-w-sm">Ready</a>')).toEqual(['Ready']);
  });
  it('Skips code attributes in expressions and keeps accessible copy', () => {
    expect(visibleStrings('<a href={"/plan - draft"} id="plan - draft" aria-label="Read plan">Ready</a>')).toEqual(['Read plan', 'Ready']);
    expect(visibleStrings('const view = { id: "plan - draft", href: "/plan - draft", title: "Plan – draft" };').filter(hasDash)).toEqual(['Plan – draft']);
  });
  it('Keeps app and message copy free of dashes', () => {
    expect(visibleCopy().filter(({ value }) => hasDash(value))).toEqual([]);
  });
});
