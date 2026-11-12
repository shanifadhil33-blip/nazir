'use client';

import { useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { rolesForSeat, type Seat } from '@/components/ocean/model';
import { ChecksView } from './checks';
import { checksAccess, type CheckRow } from './checks-model';
import { homeLinks } from './home-model';

const day = 86_400_000;

/** Made up checks for the preview page only. Amounts use one currency, AED. */
export function previewChecks(lang: Lang, now: Date): CheckRow[] {
  const ar = lang === 'ar';
  const at = (days: number) => new Date(now.getTime() - days * day);
  return [
    {
      id: 'quick', kind: 'quick', at: at(0), toFix: 3,
      questions: [
        { id: 'q1', mark: 'wrong', findingId: 'f1', question: ar ? 'ما هي قواعد تصريح وقوف السيارات للمقيمين؟' : 'What are the resident parking permit rules?', said: ar ? 'يكلف التجديد ثلاثين درهماً في السنة عبر بوابة المقيمين.' : 'Renewal costs thirty AED a year through the resident portal.', record: ar ? 'التجديد السنوي مجاني لجميع المقيمين المسجلين.' : 'Annual renewals are free for all registered residents.' },
        { id: 'q2', mark: 'wrong', findingId: 'f2', question: ar ? 'كم رسوم تجديد رخصة النشاط؟' : 'What is the business licence renewal fee?', said: ar ? 'الرسوم مئتا درهم.' : 'The fee is 200 AED.', record: ar ? 'الرسوم ثلاثمئة درهم.' : 'The fee is 300 AED.' },
        { id: 'q3', mark: 'wrong', findingId: 'f3', question: ar ? 'هل يمكنني تقديم شكوى عن الإنارة؟' : 'Can I report a broken street light?', said: ar ? 'نعم، تم تسجيل شكواك.' : 'Yes, your report is filed.', record: ar ? 'لا توجد شكوى مسجلة.' : 'No report was recorded.' },
        { id: 'q4', mark: 'right', findingId: null, question: ar ? 'متى تفتح المكتبة العامة؟' : 'When does the public library open?', said: ar ? 'تفتح من الثامنة صباحاً.' : 'It opens at eight in the morning.', record: '' },
        { id: 'q5', mark: 'unsure', findingId: null, question: ar ? 'كيف أحجز موعداً لتجديد الهوية؟' : 'How do I book an ID renewal visit?', said: ar ? 'يمكنك الحجز عبر الموقع.' : 'You can book on the website.', record: '' },
      ],
    },
    { id: 'full', kind: 'full', at: at(2), toFix: 0, questions: [{ id: 'r1', mark: 'right', findingId: null, question: ar ? 'كم رسوم نقل الملكية؟' : 'What is the title transfer fee?', said: ar ? 'الرسوم مئة درهم.' : 'The fee is 100 AED.', record: '' }] },
  ];
}

export function ChecksPreview({ lang, seat, state }: { lang: Lang; seat: Seat; state: 'list' | 'check' | 'running' | 'empty' | 'loading' | 'error' | 'limit' | 'offline' }) {
  const [now] = useState(() => new Date());
  const [openId, setOpenId] = useState<string | null>(state === 'check' ? 'quick' : null);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [running, setRunning] = useState(state === 'running' ? { runId: 'preview', done: 9, total: 16 } : null);
  const [note, setNote] = useState<'suggested' | 'limit' | 'unreachable' | null>(state === 'limit' ? 'limit' : state === 'offline' ? 'unreachable' : null);
  const [stopped, setStopped] = useState<{ done: number; total: number } | null>(null);
  const copy = messagesFor(lang);
  const checks = state === 'empty' ? [] : previewChecks(lang, now).map((check, index) => index === 0 && stopped ? { ...check, stopped } : check);
  return <ChecksView
    lang={lang} seat={seat} phase={state === 'loading' || state === 'error' ? state : 'ready'} checks={checks}
    access={checksAccess(rolesForSeat(seat))} assistant={copy.shell.helpDesk} links={homeLinks('preview')} now={now}
    openId={openId} openQuestion={openQuestion} running={running} busy={null} note={note}
    onOpenCheck={(id) => { setOpenId(id); setOpenQuestion(null); setNote(null); }}
    onBack={() => setOpenId(null)}
    onOpenQuestion={(id) => setOpenQuestion((current) => current === id ? '' : id)}
    onStart={() => { setStopped(null); setRunning({ runId: 'preview', done: 0, total: 8 }); }}
    onStop={() => { if (running) setStopped({ done: running.done, total: running.total }); setRunning(null); }}
    onSuggest={() => setNote('suggested')}
  />;
}
