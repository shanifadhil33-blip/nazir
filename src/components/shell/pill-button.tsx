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
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const classes = ['nz-pill-btn', `nz-pill-btn-${variant}`, `nz-pill-btn-${tone}`, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} data-variant={variant} data-tone={tone} {...rest}>
      {icon ? <span className="nz-pill-ico"><ShellIcon name={icon} directional={directional} /></span> : null}
      {hideLabel ? <span className="nz-sr">{label}</span> : <span>{label}</span>}
    </button>
  );
}
