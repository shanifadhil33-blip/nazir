import Link from 'next/link';
import type { ButtonHTMLAttributes } from 'react';
import { ShellIcon, type ShellIconName } from './icons';

export type PillVariant = 'ink' | 'quiet';
export type PillTone = 'neutral' | 'mint' | 'sky' | 'peach' | 'lilac';

export function PillButton({
  label,
  icon,
  variant = 'quiet',
  tone = 'neutral',
  directional = false,
  hideLabel = false,
  href,
  className,
  type = 'button',
  ...rest
}: {
  label: string;
  icon?: ShellIconName;
  variant?: PillVariant;
  tone?: PillTone;
  directional?: boolean;
  hideLabel?: boolean;
  /** When set the pill is a link, so a tap always goes somewhere. */
  href?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const classes = ['nz-pill-btn', `nz-pill-btn-${variant}`, `nz-pill-btn-${tone}`, className].filter(Boolean).join(' ');
  const inner = <>
    {icon ? <span className="nz-pill-ico"><ShellIcon name={icon} directional={directional} /></span> : null}
    {hideLabel ? <span className="nz-sr">{label}</span> : <span>{label}</span>}
  </>;
  if (href) return <Link href={href} className={classes} data-variant={variant} data-tone={tone}>{inner}</Link>;
  return (
    <button type={type} className={classes} data-variant={variant} data-tone={tone} {...rest}>
      {inner}
    </button>
  );
}
