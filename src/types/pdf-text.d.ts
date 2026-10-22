declare module 'arabic-persian-reshaper' {
  export const ArabicShaper: { convertArabic(text: string): string };
}
declare module 'bidi-js' {
  type Levels = { levels: Uint8Array; paragraphs: { start: number; end: number; level: number }[] };
  export default function bidiFactory(): {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): Levels;
    getReorderedString(text: string, levels: Levels): string;
  };
}
