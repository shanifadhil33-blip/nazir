export type ShellState = 'ready' | 'loading' | 'error' | 'empty' | 'limit';

export function StateCard({
  kind,
  title,
  body,
}: {
  kind: Exclude<ShellState, 'ready'>;
  title: string;
  body: string;
}) {
  return (
    <section className={`nz-state nz-state-${kind}`} role={kind === 'error' ? 'alert' : 'status'} data-state={kind}>
      {kind === 'loading' ? <span className="nz-state-spin" aria-hidden="true" /> : null}
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}
