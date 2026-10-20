import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { filesUnder, literals, parseSource, textOf, visibleCopy } from './helpers/source';

const forbiddenIcons = new Set(['Sparkles', 'Sparkle', 'WandSparkles', 'Wand2', 'Stars']);

export function visualViolations(text: string, file?: string): string[] {
  if (file?.endsWith('.css')) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
    return /(?:linear|radial)-gradient\s*\(|backdrop-filter\s*:/i.test(css) ? ['CSS visual effect'] : [];
  }
  const source = parseSource(text, file);
  const violations: string[] = [];
  const namespaces = new Set<string>();
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /lucide/.test(node.moduleSpecifier.text)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (forbiddenIcons.has((element.propertyName ?? element.name).text)) violations.push('Forbidden icon');
        }
      }
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (node.importClause?.name && forbiddenIcons.has(node.importClause.name.text)) violations.push('Forbidden icon');
    }
    if (ts.isPropertyAssignment(node) && /^(?:backdropFilter|['"]backdrop-filter['"])$/.test(node.name.getText())) violations.push('Backdrop filter');
    ts.forEachChild(node, visit);
  }
  visit(source);
  function visitMembers(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node) && namespaces.has(node.expression.getText()) && forbiddenIcons.has(node.name.text)) violations.push('Forbidden icon');
    ts.forEachChild(node, visitMembers);
  }
  visitMembers(source);
  for (const node of literals(source)) {
    const value = textOf(node);
    if (/(?:linear|radial)-gradient\s*\(|backdrop-filter\s*:|backdropFilter/i.test(value)) violations.push('Inline visual effect');
    if (value.includes('\u2728')) violations.push('Sparkle emoji');
    if (/\bbg-gradient(?:-|\b)/.test(value)) violations.push('Gradient');
    if (/\btext-transparent\b/.test(value) && /\bbg-clip-text\b/.test(value)) violations.push('Gradient text');
    if (/\bblur-(?:2xl|3xl)\b/.test(value)) violations.push('Blur glow');
    if (/\buppercase\b/.test(value) && /\btracking-(?:wide|widest)\b/.test(value)) violations.push('Eyebrow');
  }
  return violations;
}

it.each(['Sparkles', 'WandSparkles', 'Wand2', 'Stars', 'Sparkle'])('Rejects %s imports including aliases', (name) => {
  expect(visualViolations(`import { ${name} as Icon } from 'lucide-react';`)).not.toEqual([]);
});
it.each([
  '<p>✨</p>', '<div className="bg-gradient-to-r" />',
  '<p className="text-transparent bg-clip-text" />',
  '<div aria-hidden="true" className="blur-3xl" />', '<div className="blur-2xl" />',
  '<p className="uppercase tracking-wide" />', '<p className="uppercase tracking-widest" />',
  'import * as Icons from "lucide-react"; const view = <Icons.Sparkles />;',
])('Rejects visual pattern %s', (source) => {
  expect(visualViolations(source)).not.toEqual([]);
});
it('Allows plain text and useful neutral icons', () => {
  expect(visualViolations('import { Check } from "lucide-react"; const view = <p className="text-base">Ready</p>;')).toEqual([]);
});
it('Keeps the app free of prohibited visual patterns', () => {
  // Ocean tokens in globals.css are the N19 sea background and glass. Other files stay plain.
  const oceanSheet = (file: string) => file.replaceAll('\\', '/').endsWith('src/app/globals.css');
  const violations = filesUnder('src').filter((file) => /\.(?:tsx?|css)$/.test(file)).flatMap((file) =>
    visualViolations(readFileSync(file, 'utf8'), file)
      .filter((reason) => !(oceanSheet(file) && reason === 'CSS visual effect'))
      .map((reason) => ({ file, reason })));
  expect(violations).toEqual([]);
  expect(visibleCopy().filter(({ value }) => value.includes('\u2728'))).toEqual([]);
});

it.each([
  '<div style={{ background: "linear-gradient(red, blue)" }} />',
  '<div style={{ backgroundImage: "radial-gradient(white, black)" }} />',
  '<div style={{ backdropFilter: "blur(4px)" }} />',
  '<div style={{ "backdrop-filter": "blur(4px)" }} />',
])('Rejects inline visual effects %s', (source) => {
  expect(visualViolations(source)).not.toEqual([]);
});
it.each([
  '.hero { background: linear-gradient(red, blue); }',
  '.hero { background: radial-gradient(white, black); }',
  '.hero { backdrop-filter: blur(4px); }',
])('Rejects CSS visual effects %s', (source) => {
  expect(visualViolations(source, 'sample.css')).not.toEqual([]);
});
it('Allows plain inline styles and CSS', () => {
  expect(visualViolations('<div style={{ color: "black" }} />')).toEqual([]);
  expect(visualViolations('body { background: #FFFFFF; }', 'sample.css')).toEqual([]);
});
