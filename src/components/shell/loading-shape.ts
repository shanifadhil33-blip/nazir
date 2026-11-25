import type { Lang } from '@/components/ocean/copy';
import { demoWorkspaceId } from '@/shared/demo';

export type LoadingKind = 'home' | 'checks' | 'fixes' | 'report' | 'safetyReport' | 'history' | 'settings' | 'after' | 'map';
export type LoadingShape = { lang?: Lang; demo?: boolean; screen?: string; kind?: LoadingKind; back?: boolean; checks?: boolean; detail?: boolean };

/** URL geometry only. No person, permissions or result is inferred from the address. */
export function loadingShape(pathname: string, search: Pick<URLSearchParams, 'get' | 'has'>): LoadingShape {
  const language = search.get('lang');
  const screen = pathname.includes('/report') ? 'report' : search.get('screen') ?? 'home';
  const framed = ['report', 'history', 'settings', 'map'].includes(screen);
  const kind = pathname.includes('/report/safety/') ? 'safetyReport' : screen === 'failures' ? 'fixes'
    : ['home', 'checks', 'report', 'history', 'settings', 'after', 'map'].includes(screen) ? screen as LoadingKind : undefined;
  return {
    lang: language === 'en' || language === 'ar' ? language : undefined,
    demo: pathname.split('/')[2] === demoWorkspaceId,
    screen: framed ? screen : undefined,
    kind,
    back: screen !== 'home' || search.has('connect'),
    checks: screen === 'checks',
    detail: (screen === 'checks' && (search.has('check') || search.has('safety'))) || (screen === 'map' && search.has('item')),
  };
}
