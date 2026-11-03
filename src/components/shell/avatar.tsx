export function Avatar({ initials, label }: { initials: string; label: string }) {
  return <span className="nz-avatar-initials" role="img" aria-label={label}>{initials}</span>;
}
