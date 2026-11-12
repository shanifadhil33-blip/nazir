import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import type { ReportBody } from './build';
import { ArabicShaper } from 'arabic-persian-reshaper';
import bidiFactory from 'bidi-js';

const bidi = bidiFactory();

/** Shape logical text, then reorder each wrapped line using Unicode bidi rules. */
export function shapePdfLine(text: string, direction: 'en' | 'ar'): string {
  // Ratios are read left to right even inside an Arabic paragraph.
  const shaped = ArabicShaper.convertArabic(text).replace(/\d+\s*\/\s*\d+/g, (ratio) => `\u202a${ratio}\u202c`);
  return bidi.getReorderedString(shaped, bidi.getEmbeddingLevels(shaped, direction === 'ar' ? 'rtl' : 'ltr')).replace(/[\u202a-\u202e]/g, '');
}

/** PDF copy never uses dash punctuation or invisible direction controls. */
export function cleanPdfText(text: string): string {
  return text.replace(/[-\u2010-\u2015\u2212_]/g, ' ').replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Wrap logical text before shaping so joins and bidi order respect line boundaries. */
export function wrapPdfText(text: string, width: number, measure: (line: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of cleanPdfText(text).split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) { line = next; continue; }
    if (line) { lines.push(line); line = ''; }
    // Also break long identifiers and words without spaces.
    for (const char of word) {
      if (line && measure(line + char) > width) { lines.push(line); line = ''; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Scope belongs to the frozen check, independent of today's connection. */
export function reportConnectionScope(body: ReportBody, lang: 'en' | 'ar'): string | null {
  return body.run.connection_scope === 'replies_only' ? (lang === 'ar' ? ar : en).connect.replyScope : null;
}
