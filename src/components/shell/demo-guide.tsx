'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { DemoProgress } from '@/server/shell/demo-progress';
import { useMemberSnapshot } from './member-snapshot';

export function recordDemoView(workspaceId: string, view: 'check' | 'fix' | 'after', id: string) {
  return fetch(`/api/workspaces/${workspaceId}/demo-progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ view, id }) }).catch(() => null);
}
/** A reloaded or shared detail counts too. Validated against the actual report or tested fix on the server. */
export function DemoViewMarker({ workspaceId, view, id }: { workspaceId: string; view: 'check' | 'fix' | 'after'; id?: string | null }) {
  const snapshot = useMemberSnapshot(workspaceId);
  useEffect(() => { if (snapshot?.kind === 'demo' && id) void recordDemoView(workspaceId, view, id); }, [snapshot?.kind, workspaceId, view, id]);
  return null;
}
export function DemoGuide({ lang, home, progress }: { lang: Lang; home: string; progress: DemoProgress }) {
  const text = messagesFor(lang).demo;
  const steps = [text.stepCheck, text.stepWrong, text.stepApprove, text.stepAfter, text.stepDone];
  const href = progress.step >= 4 ? `/signin?lang=${lang}` : progress.step >= 3 && progress.fixId ? `${home}?screen=after&fix=${progress.fixId}` : progress.step === 2 ? `${home}?screen=failures${progress.fixId ? `&fix=${progress.fixId}` : ''}` : `${home}?screen=checks${progress.checkId ? `&check=${progress.checkId}&show=wrong` : ''}`;
  return <section className="nz-demo-guide"><strong>{progress.step >= 4 ? text.guideDone : text.tryThis}</strong><Link href={progress.step >= 4 ? href : `${href}&lang=${lang}`}>{steps[Math.min(progress.step, 4)]}</Link></section>;
}
