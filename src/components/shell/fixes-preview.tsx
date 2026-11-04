'use client';

import { useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { rolesForSeat, type Seat } from '@/components/ocean/model';
import { AfterView } from './after';
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
    recheck: 12, rerun: false,
  };
  const approved: FixCard = { ...waiting, id: 'f2', status: 'approved', title: ar ? 'أكد الرسوم من السجل' : 'Quote fees from the record', recheck: 8 };
  const down: FixCard = { ...waiting, id: 'f3', status: 'turnedDown', title: ar ? 'اختصر الرد' : 'Shorten the reply' };
  if (state === 'empty' || state === 'loading' || state === 'error') return [];
  if (state === 'done') return [{ ...approved, rerun: true }, down];
  return [waiting, approved];
}

export const previewChange: Change = { before: 74, after: 82, fixed: 9, stillWrong: 2, newlyWrong: 0, english: 83, arabic: 81 };

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
    return <AfterView lang={lang} seat={seat} phase={state === 'loading' || state === 'error' ? state : 'ready'} change={state === 'empty' ? null : previewChange} canStart={canStart} assistant={copy.shell.helpDesk} links={links} />;
  }
  const act = (id: string, action: FixAction) => {
    setBusy({ id, action });
    setTimeout(() => {
      setBusy(null);
      setFixes((list) => list.map((item) => item.id !== id ? item : action === 'approve' ? { ...item, status: 'approved' } : action === 'reject' ? { ...item, status: 'turnedDown' } : { ...item, rerun: true }));
      setNote(action === 'approve' ? 'approvedNote' : action === 'reject' ? 'turnedNote' : 'rerunStarted');
    }, 400);
  };
  return <FixesView
    lang={lang} seat={seat} phase={state === 'loading' || state === 'error' ? state : 'ready'} fixes={fixes} access={fixesAccess(rolesForSeat(seat))} canStart={canStart}
    assistant={copy.shell.helpDesk} links={links} tab={tab} openId={openId} busy={busy} note={note}
    onTab={setTab} onToggle={(id) => setOpenId((current) => current === id ? '' : id)} onAction={act}
  />;
}
