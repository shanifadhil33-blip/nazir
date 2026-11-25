import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import { localeAttrs } from './locale';
import { Heading } from '@/components/heading';
import type { LoadingShape } from './loading-shape';

/** Neutral geometry while the signed in shell streams. No invented identity or results. */
export function ShellLoading({ lang, demo, screen, kind, back, checks, detail }: LoadingShape = {}) {
  return <main className="nz-shell nz-shell-loading" {...(lang ? localeAttrs(lang) : {})} data-screen={screen} role="status" aria-busy="true">
    <span className="nz-visually-hidden">{lang === 'ar' ? ar.shell.loadingTitle : en.shell.loadingTitle}{!lang ? <span lang="ar" dir="rtl"> {ar.shell.loadingTitle}</span> : null}</span>
    <div className="nz-shell-desk" aria-hidden="true">
      <div className="nz-shell-head"><div className="nz-shell-who"><i className="nz-placeholder nz-placeholder-avatar" /><div className="nz-placeholder-lines"><i className="nz-placeholder" /><i className="nz-placeholder" /></div></div><i className="nz-placeholder nz-placeholder-avatar" /></div>
      {demo ? <div className="nz-demo-bar nz-loading-demo"><i className="nz-placeholder" /></div> : null}
      <div className="nz-shell-stack">
        {back ? <div className="nz-loading-back"><i className="nz-placeholder" /></div> : null}
        <LoadingTitle lang={lang} kind={kind} detail={detail} />
        {checks && !detail ? <div className="nz-checks-body">
          <div className="nz-checks-list">{[0, 1, 2].map((i) => <section key={i} className="nz-placeholder-card nz-loading-row"><i className="nz-placeholder nz-placeholder-avatar" /><div className="nz-placeholder-lines"><i className="nz-placeholder" /><i className="nz-placeholder" /></div></section>)}</div>
          <section className="nz-placeholder-card nz-loading-detail"><i className="nz-placeholder nz-placeholder-title" /><i className="nz-placeholder" /><i className="nz-placeholder" /></section>
        </div> : kind === 'report' ? <>
          <section className="nz-placeholder-card nz-loading-report-hero"><i className="nz-placeholder nz-loading-headline" /><i className="nz-placeholder nz-loading-caption" /></section>
          <div className="nz-rep-rows">{[0, 1, 2].map((i) => <div key={i} className="nz-rep-row nz-loading-report-row"><i className="nz-placeholder nz-loading-report-icon" /><i className="nz-placeholder nz-loading-report-label" /></div>)}</div>
        </> : <>
          <section className="nz-placeholder-card"><i className="nz-placeholder nz-placeholder-title" /><i className="nz-placeholder" /><i className="nz-placeholder nz-placeholder-button" /></section>
          <section className="nz-placeholder-card"><i className="nz-placeholder" /><i className="nz-placeholder" /></section>
        </>}
      </div>
    </div>
    <div className="nz-float-nav" aria-hidden="true"><div className="nz-float-bar">{[0, 1, 2, 3, 4].map((i) => <div key={i} className={i === 2 ? 'nz-float-start nz-loading-start' : 'nz-float-item'}><i className="nz-placeholder nz-loading-icon" /><i className="nz-placeholder nz-loading-label" /></div>)}</div></div>
    <div className="nz-side-nav" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={i === 2 ? 'nz-side-start nz-loading-start' : 'nz-side-item'}><i className="nz-placeholder nz-loading-icon" /><i className="nz-placeholder nz-loading-label" /></div>)}</div>
  </main>;
}

/** Static section labels can reserve their exact translated size before account data arrives. */
function LoadingTitle({ lang, kind, detail }: Pick<LoadingShape, 'lang' | 'kind' | 'detail'>) {
  if (!lang || !kind || kind === 'home' || detail) return <i className={`nz-placeholder nz-loading-title${detail ? ' nz-loading-title-stack' : ''}`} />;
  const copy = lang === 'ar' ? ar : en;
  const titles = { checks: copy.checksScreen, fixes: copy.fixesScreen, report: copy.reportScreen, safetyReport: copy.reportScreen, history: copy.historyScreen, settings: copy.settingsScreen, after: copy.afterScreen, map: copy.mapScreen };
  const text = titles[kind];
  if (kind === 'checks') return <div className="nz-checks-head"><div><Heading light={text.light} bold={text.bold} lang={lang} flow="inline" explain={copy.checksScreen.explain} /></div><div className="nz-tabs nz-loading-tabs"><i className="nz-placeholder" /><i className="nz-placeholder" /></div></div>;
  return <>
    <Heading light={text.light} bold={text.bold} lang={lang} flow={kind === 'after' || kind === 'fixes' ? 'inline' : 'stack'} explain={kind === 'history' ? copy.historyScreen.explain : undefined} />
    {kind === 'report' ? <p className="nz-check-sub">{copy.reportScreen.line}</p> : kind === 'settings' ? <p className="nz-check-sub">{copy.settingsScreen.line}</p> : kind === 'map' ? <p className="nz-check-sub">{copy.mapScreen.intro}</p> : null}
  </>;
}
