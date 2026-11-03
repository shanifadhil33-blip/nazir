type HeadingTag = 'h1' | 'h2' | 'h3';

/** Two stacked lines: a light line, then a bold line. Callers pass already translated copy. */
export function Heading({ light, bold, as: Tag = 'h1', lang }: {
  light: string;
  bold: string;
  as?: HeadingTag;
  lang?: 'en' | 'ar';
}) {
  const dir = lang === 'ar' ? 'rtl' : lang === 'en' ? 'ltr' : undefined;
  return (
    <Tag className="nz-heading" lang={lang} dir={dir}>
      <span className="nz-heading-light">{light}</span>
      <span className="nz-heading-bold">{bold}</span>
    </Tag>
  );
}
