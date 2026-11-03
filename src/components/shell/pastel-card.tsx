import type { ReactNode } from 'react';
import { ShellIcon, type ShellIconName } from './icons';

export type PastelTone = 'mint' | 'sky' | 'peach';

export function PastelCard({
  tone,
  title,
  value,
  caption,
  icon,
  layout = 'compact',
}: {
  tone: PastelTone;
  title: string;
  value: ReactNode;
  caption?: string;
  icon?: ShellIconName;
  layout?: 'compact' | 'stat';
}) {
  const mark = icon ? <span className="nz-pastel-mark"><ShellIcon name={icon} /></span> : null;
  return (
    <article className={`nz-pastel nz-pastel-${tone} nz-pastel-${layout}`} data-tone={tone}>
      {layout === 'compact' ? <div className="nz-pastel-top">{mark}<p className="nz-pastel-title">{title}</p></div> : <p className="nz-pastel-title">{title}</p>}
      <p className="nz-pastel-value">{value}</p>
      {caption ? <p className="nz-pastel-caption">{caption}</p> : null}
      {layout === 'stat' ? mark : null}
    </article>
  );
}
