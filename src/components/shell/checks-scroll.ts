export type CheckPane = 'list' | 'check';

/** Phone list and detail share one window. Opening a check starts at the top and Back returns to the list spot. */
export function paneScroll(previous: CheckPane, next: CheckPane, phone: boolean, y: number, saved: number): { top: number; saved: number } | null {
  if (!phone || previous === next) return null;
  if (next === 'check') return { top: 0, saved: y };
  return { top: saved, saved };
}
