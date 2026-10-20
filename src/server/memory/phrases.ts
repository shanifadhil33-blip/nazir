import { lessonFamilies, type LessonEffect } from './effects';

const lasting = /\balways\b|\bnext time\b|دائما|في المرة/i;
const arabic = /[\u0600-\u06FF]/;
const queues: { pattern: RegExp; category: 'complaint' | 'suggestion' | 'information'; queue: string }[] = [
  { pattern: /طابور الشكاوى|complaint queue|complaints queue/i, category: 'complaint', queue: 'complaint_review' },
  { pattern: /طابور الاقتراحات|suggestion queue|suggestions queue/i, category: 'suggestion', queue: 'suggestions' },
  { pattern: /طابور المعلومات|information queue|general information queue/i, category: 'information', queue: 'general_information' },
];

/** True when a lasting instruction appears anywhere in the sentence. */
export function hasLastingPhrase(message: string) {
  return lasting.test(message);
}

/** A correction the planner can store. A queue phrase wins, then the longest named family, then a note. */
export function correctionFrom(message: string): { text: string; language: 'en' | 'ar'; effect: LessonEffect } | null {
  if (!hasLastingPhrase(message)) return null;
  const text = message.trim().slice(0, 500);
  // A question is not a correction: "Why does it always fail?" must not become a lesson.
  if (/[?؟]\s*$/.test(text)) return null;
  if (text.length < 3) return null;
  const language = arabic.test(text) ? 'ar' : 'en';
  const queue = queues.find((item) => item.pattern.test(text));
  if (queue) return { text, language, effect: { kind: 'check_queue', category: queue.category, queue: queue.queue } };
  const family = [...lessonFamilies].sort((a, b) => b.length - a.length).find((name) => text.includes(name));
  if (family) return { text, language, effect: { kind: 'test_first', family } };
  return { text, language, effect: { kind: 'note' } };
}
