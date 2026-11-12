'use client';

import { assembleReport } from '@/server/reports/build';

import { useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { rolesForSeat, type Seat } from '@/components/ocean/model';
import type { StoredFix } from './fixes-model';
import { HistoryView } from './history';
import { buildHistory, historyAccess } from './history-model';
import { homeLinks } from './home-model';
import { ReportView, type ReportNote } from './report';
import { previewFacts } from './report-model';
import { SettingsViewScreen, type ResetState } from './settings';
import { previewPeople, settingsAccess } from './settings-model';

export type MorePreviewState = 'ready' | 'older' | 'empty' | 'loading' | 'error' | 'people' | 'ask' | 'done';

const phaseOf = (state: MorePreviewState) => state === 'loading' || state === 'error' ? state : 'ready';

/** Made up history for the preview page only: Yusuf approved, Omar suggested, a check yesterday. */
function previewItems(lang: Lang, state: MorePreviewState, now: Date) {
  if (state === 'empty') return [];
  const copy = messagesFor(lang);
  const at = (days: number, hour: number, minute: number) => {
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(now.getTime() - days * 86_400_000));
    return new Date(`${ymd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+04:00`);
  };
  const title = { en: "Don't confirm rumours", ar: 'لا تؤكد الإشاعات' };
  const fixes: StoredFix[] = [{
    id: 'a', findingId: 'a', status: 'approved', by: { name: copy.shell.omar, initials: 'OS', mine: false }, title, recheck: 12, rerun: false,
    at: at(0, 9, 15).toISOString(), decided: { at: at(0, 11, 40).toISOString(), name: copy.shell.yusuf, initials: 'YR', status: 'approved' },
  }];
  const snapshot = (id: string, count: number) => assembleReport({ run: { id, status: 'passed', calls_used: 0, calls_budget: count }, conversations: Array.from({ length: count }, (_, i) => ({ id: `${id}-${i}`, status: 'passed', split: 'development', language: 'en' })), findings: [], messages: [] });
  const reports = [{ id: 'c', created_at: at(1, 15, 20).toISOString(), body: snapshot('c', 16) }, { id: 'd', created_at: at(4, 10, 5).toISOString(), body: snapshot('d', 12) }];
  return buildHistory(reports, fixes, lang, copy);
}

export function MorePreview({ screen, lang, seat, state }: { screen: 'history' | 'settings' | 'report'; lang: Lang; seat: Seat; state: MorePreviewState }) {
  const copy = messagesFor(lang);
  const roles = rolesForSeat(seat);
  const links = homeLinks('preview');
  const canStart = seat === 'owner' || seat === 'editor';
  const now = new Date();
  const [older, setOlder] = useState(state === 'older');
  const [people, setPeople] = useState(state !== 'ask');
  const [reset, setReset] = useState<ResetState>(state === 'ask' ? 'ask' : state === 'done' ? 'done' : 'idle');
  const [note, setNote] = useState<ReportNote>(state === 'done' ? 'copied' : null);
  const common = { lang, seat, phase: phaseOf(state) as 'loading' | 'ready' | 'error', canStart, links, assistant: copy.shell.helpDesk };
  const history = historyAccess(roles);
  if (screen === 'history') return <HistoryView {...common} allowed={history} items={previewItems(lang, state, now)} now={now} older={older} onOlder={() => setOlder(true)} />;
  if (screen === 'settings') {
    const act = (next: ResetState, after?: ResetState) => { setReset(next); if (after) setTimeout(() => setReset(after), 500); };
    return <SettingsViewScreen {...common} history={history} peopleOpen={people} reset={reset} access={settingsAccess(roles)}
      view={{ assistant: copy.shell.helpDesk, topic: 'government', language: lang, people: previewPeople(copy) }}
      onPeople={() => setPeople((open) => !open)} onAsk={() => setReset('ask')} onCancel={() => setReset('idle')} onConfirm={() => act('busy', 'done')} />;
  }
  return <ReportView {...common} history={history} workspaceId="preview" now={now} note={note}
    facts={state === 'empty' ? null : previewFacts(now)}
    onDownload={() => setNote('downloading')} onShare={() => { setNote('sharing'); setTimeout(() => setNote('copied'), 400); }} />;
}
