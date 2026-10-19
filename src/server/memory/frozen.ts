import type { LessonEffect } from './effects';
/** A lesson frozen into a plan and its run manifest. Later edits never change a past run. */
export type FrozenLesson = { lesson_id: string; version: number; text: string; text_ar: string | null; effect: LessonEffect; reason: { en: string; ar: string } };
const queueChecks = ['right_queue', 'linked_escalation', 'reply_matches_record'];
/** The lessons a finding names: the ones that shaped how its family or check was tested. */
export function lessonsForFinding(lessons: FrozenLesson[] | undefined, family: string, checkId: string) {
  return (lessons ?? []).filter((l) => {
    const e = l.effect;
    if (e.kind === 'check_queue') return queueChecks.includes(checkId);
    if (e.kind === 'judge_note') return e.family === family && checkId === 'semantic';
    if (e.kind === 'test_first' || e.kind === 'test_harder') return e.family === family;
    return false;
  }).map((l) => ({ lesson_id: l.lesson_id, version: l.version, text: l.text, reason: l.reason }));
}
/** Approved reviewer notes passed to the reply review for one family. */
export function judgeNotes(lessons: FrozenLesson[] | undefined, family: string) {
  return (lessons ?? []).flatMap((l) => l.effect.kind === 'judge_note' && l.effect.family === family ? [l.effect.note] : []);
}
