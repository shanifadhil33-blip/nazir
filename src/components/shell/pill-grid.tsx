import type { ReactNode } from 'react';

/** Two columns. Direction on an ancestor mirrors the cells. */
export function PillGrid({ children }: { children: ReactNode }) {
  return <div className="nz-pill-grid">{children}</div>;
}
