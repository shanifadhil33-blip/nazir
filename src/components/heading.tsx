type HeadingTag = 'h1' | 'h2' | 'h3';

/** A light line, then a bold line. Stacked by default, one line when flow is inline. Callers pass already translated copy. */
export function Heading({ light, bold, as: Tag = 'h1', lang, flow = 'stack' }: {
  light: string;
  bold: string;
  as?: HeadingTag;
  lang?: 'en' | 'ar';
  flow?: 'stack' | 'inline';
}) {
  const dir = lang === 'ar' ? 'rtl' : lang === 'en' ? 'ltr' : undefined;
  return (
    <Tag className={flow === 'inline' ? 'nz-heading nz-heading-inline' : 'nz-heading'} lang={lang} dir={dir}>
      <span className="nz-heading-light">{light}</span>
      {flow === 'inline' ? ' ' : null}
      <span className="nz-heading-bold">{bold}</span>
    </Tag>
  );
}
