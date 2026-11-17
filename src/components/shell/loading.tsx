import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';

/** Neutral geometry while the signed in shell streams. No invented identity or results. */
export function ShellLoading() {
  return <main className="nz-shell nz-shell-loading" role="status" aria-busy="true">
    <span className="nz-visually-hidden">{en.shell.loadingTitle}<span lang="ar" dir="rtl"> {ar.shell.loadingTitle}</span></span>
    <div className="nz-shell-desk" aria-hidden="true">
      <div className="nz-shell-head"><div className="nz-shell-who"><i className="nz-placeholder nz-placeholder-avatar" /><div className="nz-placeholder-lines"><i className="nz-placeholder" /><i className="nz-placeholder" /></div></div><i className="nz-placeholder nz-placeholder-avatar" /></div>
      <div className="nz-shell-stack"><div className="nz-placeholder nz-placeholder-title" /><section className="nz-placeholder-card"><i className="nz-placeholder nz-placeholder-title" /><i className="nz-placeholder" /><i className="nz-placeholder nz-placeholder-button" /></section><section className="nz-placeholder-card"><i className="nz-placeholder" /><i className="nz-placeholder" /></section></div>
    </div>
    <div className="nz-loading-nav" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} className="nz-placeholder nz-placeholder-avatar" />)}</div>
  </main>;
}
