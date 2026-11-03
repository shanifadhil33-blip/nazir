export type ChipKind = 'right' | 'wrong' | 'unsure';

export function Chip({ kind, label }: { kind: ChipKind; label: string }) {
  return <span className={`nz-mark nz-mark-${kind}`} data-chip={kind}>{label}</span>;
}
