'use client';

import { useEffect, useState } from 'react';
import { Heading } from '@/components/heading';
import { fill, messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import type { AgentMap, MapGroup } from '@/server/safety/map';
import { DocumentLocale } from './document-locale';
import { ScreenFrame } from './frame';
import { historyAccess } from './history-model';
import { homeLinks } from './home-model';
import { useMemberData } from './member-data';
import { StateCard } from './state-card';

const order: MapGroup[] = ['tools', 'mcp', 'services', 'data', 'permissions'];

/** ?screen=map: what your agent can use, grouped, with plain risk labels and how many safety tests aim at each. */
export function AgentMapScreen({ workspaceId, initialLang }: { workspaceId: string; initialLang: Lang }) {
  const data = useMemberData(workspaceId, initialLang, false);
  const lang = data.lang;
  const copy = messagesFor(lang);
  const text = copy.mapScreen;
  const [map, setMap] = useState<AgentMap | null | 'error'>(null);
  useEffect(() => {
    let alive = true;
    void fetch(`/api/workspaces/${workspaceId}/agent-map`, { headers: { 'accept-language': lang } })
      .then(async (r) => { if (alive) setMap(r.ok ? await r.json() as AgentMap : 'error'); })
      .catch(() => { if (alive) setMap('error'); });
    return () => { alive = false; };
  }, [workspaceId, lang]);
  const links = homeLinks(workspaceId, lang);
  const phase = data.phase === 'error' || map === 'error' ? 'error' : data.phase === 'ready' && map ? 'ready' : 'loading';
  const ready = map && map !== 'error' ? map : null;
  return <>
    <DocumentLocale lang={lang} />
    <ScreenFrame lang={lang} seat={seatFromRoles(data.roles)} phase={phase} name="map" className="nz-map" assistant={data.assistant} person={data.person} links={links} canStart={data.canStart} history={historyAccess(data.roles)} onRetry={data.reload}>
      <Heading light={text.light} bold={text.bold} lang={lang} />
      <p className="nz-check-sub">{text.intro}</p>
      {ready && ready.scope !== 'full' ? <>
        <StateCard kind="empty" title={ready.scope === 'replies_only' ? text.empty : copy.safetyScreen.needAgent} action={{ label: ready.scope === 'replies_only' ? text.addSdk : copy.connect.title, href: ready.scope === 'replies_only' ? `${links.home}?connect=full&lang=${lang}` : `${links.home}?lang=${lang}` }} />
        {ready.skills.length ? <section className="nz-map-group"><h2>{text.skills}</h2><ul className="nz-map-items">{ready.skills.map((s) => <li key={s} className="nz-map-item"><strong dir="auto">{s}</strong></li>)}</ul></section> : null}
      </> : null}
      {ready && ready.scope === 'full' && ready.items.length === 0 ? <StateCard kind="empty" title={text.none} /> : null}
      {ready && ready.dangerMix ? <section className="nz-map-danger" role="note"><strong>{text.dangerMix}</strong><p>{text.dangerMixNote}</p></section> : null}
      {ready ? order.map((group) => {
        const items = ready.items.filter((i) => i.group === group);
        if (!items.length) return null;
        return (
          <section key={group} className="nz-map-group" data-group={group}>
            <h2>{text.groups[group]}</h2>
            <ul className="nz-map-items">
              {items.map((item) => (
                <li key={item.id} className="nz-map-item" data-item={item.id}>
                  <strong dir="auto">{item.name}</strong>
                  {item.purpose ? <p dir="auto">{item.purpose}</p> : null}
                  {item.risks.length ? <p className="nz-safety-chips">{item.risks.map((r) => <span key={r} className="nz-mark nz-map-risk" data-risk={r}>{text.risks[r]}</span>)}</p> : null}
                  {item.tests ? <small>{fill(text.aimed, { n: String(item.tests) })}</small> : null}
                </li>
              ))}
            </ul>
          </section>
        );
      }) : null}
    </ScreenFrame>
  </>;
}
