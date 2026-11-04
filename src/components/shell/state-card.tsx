import { ShellIcon, type ShellIconName } from './icons';
import { PillButton } from './pill-button';

export type ShellState = 'ready' | 'loading' | 'error' | 'empty' | 'limit' | 'offline' | 'view';
export type StateKind = Exclude<ShellState, 'ready'>;

const icons: Record<Exclude<StateKind, 'loading'>, ShellIconName> = {
  error: 'alert',
  empty: 'checks',
  limit: 'tick',
  offline: 'alert',
  view: 'eye',
};

export type StateAction = { label: string; onClick?: () => void; href?: string };

/** One small state: a soft icon in a circle, one short line, and at most one pill. Same card on every screen. */
export function StateCard({ kind, title, body, action }: { kind: StateKind; title: string; body?: string; action?: StateAction | null }) {
  const loud = kind === 'error';
  return (
    <section className={`nz-state nz-state-${kind}`} role={loud ? 'alert' : 'status'} data-state={kind}>
      <span className="nz-state-ico" aria-hidden="true">
        {kind === 'loading' ? <span className="nz-state-spin" /> : <ShellIcon name={icons[kind]} />}
      </span>
      <div className="nz-state-text">
        <h2>{title}</h2>
        {body ? <p>{body}</p> : null}
        {kind === 'loading' ? <span className="nz-state-bars" aria-hidden="true"><i /><i /></span> : null}
      </div>
      {action ? <PillButton variant="ink" className="nz-state-act" label={action.label} onClick={action.onClick} href={action.href} /> : null}
    </section>
  );
}

/** The loading and error card every screen shows while its data is not ready. Try again sits inside the card. */
export function PhaseCard({ phase, copy, onRetry, fallback }: { phase: 'loading' | 'error'; copy: { shell: { loadingTitle: string; errorTitle: string; retry: string } }; onRetry?: () => void; /** Where Try again goes when there is nothing to run again. */ fallback?: string }) {
  if (phase === 'loading') return <StateCard kind="loading" title={copy.shell.loadingTitle} />;
  return <StateCard kind="error" title={copy.shell.errorTitle} action={onRetry ? { label: copy.shell.retry, onClick: onRetry } : fallback ? { label: copy.shell.retry, href: fallback } : null} />;
}
