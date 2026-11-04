import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { homeLinks } from './home-model';
import { ScreenFrame } from './frame';
import { StateCard } from './state-card';

/** All small states on one board, for the design preview page. */
export function StatesBoard({ lang, seat }: { lang: Lang; seat: Seat }) {
  const copy = messagesFor(lang);
  const links = homeLinks('preview');
  const retry = { label: copy.shell.retry, href: links.home };
  return (
    <ScreenFrame lang={lang} seat={seat} phase="ready" name="states" assistant="" links={links} canStart history>
      <Heading light={copy.shell.statesLight} bold={copy.shell.statesBold} lang={lang} />
      <StateCard kind="loading" title={copy.shell.loadingTitle} />
      <StateCard kind="error" title={copy.shell.errorTitle} action={retry} />
      <StateCard kind="empty" title={copy.shell.emptyTitle} action={{ label: copy.shell.startCheck, href: links.start }} />
      <StateCard kind="limit" title={copy.shell.limitTitle} />
      <StateCard kind="offline" title={copy.shell.offlineTitle} action={retry} />
      <StateCard kind="view" title={copy.shell.viewOnly} />
    </ScreenFrame>
  );
}
