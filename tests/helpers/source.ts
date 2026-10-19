import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

export function parseSource(text: string, file = 'sample.tsx') {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

export function literals(source: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node) ||
        ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

export function textOf(node: ts.Node): string {
  return (node as ts.Node & { text: string }).text;
}

function isCodeLiteral(node: ts.Node): boolean {
  // Attribute expressions carry the same code values as quoted attributes.
  const parent = ts.isJsxExpression(node.parent) ? node.parent.parent : node.parent;
  if ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return true;
  if (ts.isJsxAttribute(parent) && /^(className|class|id|href|src|lang|dir|key|htmlFor|data-.*|aria-describedby|aria-labelledby)$/.test(parent.name.getText())) return true;
  if (ts.isCallExpression(parent) && (parent.expression.getText() === 'import' || parent.expression.getText() === 'require')) return true;
  if (ts.isPropertyAssignment(parent) && /^(className|class|id|href|src|lang|dir|key|htmlFor)$/.test(parent.name.getText())) return true;
  const value = textOf(node).trim();
  return /^(https?:\/\/\S+|(?:\.{1,2}\/|@\/)[^\s]+)$/.test(value);
}

export function visibleStrings(text: string, file?: string): string[] {
  return literals(parseSource(text, file)).filter((node) => !isCodeLiteral(node)).map(textOf);
}

function jsonValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(jsonValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(jsonValues);
  return [];
}

export function visibleCopy(): { file: string; value: string }[] {
  return [
    ...filesUnder('src').filter((file) => /\.tsx?$/.test(file)).flatMap((file) =>
      visibleStrings(readFileSync(file, 'utf8'), file).map((value) => ({ file, value }))),
    ...filesUnder('messages').filter((file) => file.endsWith('.json')).flatMap((file) =>
      jsonValues(JSON.parse(readFileSync(file, 'utf8'))).map((value) => ({ file, value }))),
  ];
}
