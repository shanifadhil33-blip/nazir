import type { ReactNode } from 'react';

export function WhiteCard({
  kicker,
  title,
  live = false,
  children,
}: {
  kicker?: string;
  title?: string;
  live?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="nz-white">
      {kicker ? <p className="nz-white-kicker">{kicker}</p> : null}
      {title ? <p className="nz-white-line"><strong>{title}</strong>{live ? <span className="nz-live-dot" aria-hidden="true" /> : null}</p> : null}
      {children}
    </section>
  );
}
