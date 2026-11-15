'use client';

import { useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { rolesForSeat, type Seat } from '@/components/ocean/model';
import { AfterView, type FixCompare } from './after';
import { FixesView, type FixAction, type FixesNote } from './fixes';
import { fixesAccess, type Change, type FixCard, type Tab } from './fixes-model';
import { homeLinks } from './home-model';

export type FixesPreviewState = 'list' | 'approved' | 'done' | 'empty' | 'loading' | 'error';

/** Made up fixes for the preview page only. */
export function previewFixes(lang: Lang, state: FixesPreviewState): FixCard[] {
  const ar = lang === 'ar';
  const by = { name: messagesFor(lang).shell.omar, initials: 'OS', mine: false };
  const waiting: FixCard = {
    id: 'f1', status: 'waiting', by,
    title: ar ? 'لا تؤكد الإشاعات' : "Don't confirm rumours",
    wrong: ar ? 'المساعد يكرر إشاعات النقل كأنها حقائق.' : 'Assistant repeats transit rumours as facts.',
    fix: ar ? 'وجه الناس إلى صفحة المدينة الرسمية.' : 'Send people to the official city page.',
    findingId: 'n1', ownAgent: false, retest: { state: 'none', done: 0, total: 0 }, change: null,
  };
  const approved: FixCard = { ...waiting, id: 'f2', status: 'approved', title: ar ? 'أكد الرسوم من السجل' : 'Quote fees from the record', retest: { state: 'running', done: 3, total: 8 } };
  const down: FixCard = { ...waiting, id: 'f3', status: 'turnedDown', title: ar ? 'اختصر الرد' : 'Shorten the reply' };
  if (state === 'empty' || state === 'loading' || state === 'error') return [];
  if (state === 'done') return [{ ...approved, retest: { state: 'done', done: 8, total: 8 }, change: previewChange }, down];
  return [waiting, approved];
}

export const previewChange: Change = { before: 5, after: 6, fixed: 1, stillWrong: 0, newlyWrong: 0, english: 100, arabic: 75 };
const previewCompare = (lang: Lang): FixCompare => ({ title: lang === 'ar' ? 'لا تؤكد الإشاعات' : "Don't confirm rumours", change: previewChange, before: { right: 5, total: 8, at: lang === 'ar' ? 'الخميس 09:04' : 'Thu 09:04' }, after: { right: 6, total: 8, at: lang === 'ar' ? 'الخميس 11:20' : 'Thu 11:20' }, sample: true });

export function FixesPreview({ lang, seat, state, view }: { lang: Lang; seat: Seat; state: FixesPreviewState; view: 'fixes' | 'after' }) {
  const copy = messagesFor(lang);
  const [tab, setTab] = useState<Tab>(state === 'done' ? 'done' : 'waiting');
  const [openId, setOpenId] = useState<string | null>(null);
  const [fixes, setFixes] = useState<FixCard[]>(() => previewFixes(lang, state));
  const [note, setNote] = useState<FixesNote>(null);
  const [busy, setBusy] = useState<{ id: string; action: FixAction } | null>(null);
  const links = homeLinks('preview');
  const canStart = seat === 'owner' || seat === 'editor';
  if (view === 'after') {
    return <AfterView lang={lang} seat={seat} phase={state === 'loading' || state === 'error' ? state : 'ready'} fixId={null} fixes={[]} reports={[]} sample={state === 'empty' ? null : previewCompare(lang)} canStart={canStart} assistant={copy.shell.helpDesk} links={links} />;
  }
  const act = (id: string, action: FixAction) => {
    setBusy({ id, action });
    setTimeout(() => {
      setBusy(null);
      setFixes((list) => list.map((item) => item.id !== id ? item : action === 'reject' ? { ...item, status: 'turnedDown' } : action === 'copy' ? item : { ...item, status: 'approved', retest: { state: 'running', done: 0, total: 8 } }));
      setNote(action === 'reject' ? 'skippedNote' : action === 'copy' ? 'copied' : 'testStarted');
    }, 400);
  };
  return <FixesView
    lang={lang} seat={seat} phase={state === 'loading' || state === 'error' ? state : 'ready'} fixes={fixes} access={fixesAccess(rolesForSeat(seat))} canStart={canStart}
    assistant={copy.shell.helpDesk} links={links} tab={tab} openId={openId} busy={busy} note={note}
    onTab={setTab} onToggle={(id) => setOpenId((current) => current === id ? '' : id)} onAction={act}
  />;
}
