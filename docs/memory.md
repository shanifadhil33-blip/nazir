# Memory (N16)

Nazir learns from corrections inside one workspace only. Every lesson is visible, editable and undoable.

## Lesson effects
A lesson may only carry one of these effects (`src/server/memory/effects.ts`, checked again by the `b_lesson_effect` trigger in 0015):

| Effect | Scope | What it does |
| --- | --- | --- |
| `note` | small | Kept for people; changes nothing. |
| `test_first{family}` | small | That family goes first in the next plan. |
| `test_harder{family,repeats 2 or 3}` | small | That family runs more times. |
| `check_queue{category,queue}` | small | Families with queue checks for that category go first. The queue must equal the approved routing map, so a lesson can never change an expected result. |
| `judge_note{family,note}` | big | The reply review sees the note as an approved reviewer note. |

Big lessons wait for the service owner (`approveBigLesson`, with a reason, never by the member who created or last changed the lesson). Undo never makes a big lesson active by itself.

## Flows
* "Should I remember this?" After a correction, `suggestLessonFromCorrection` stores a suggested lesson; a one off correction stores nothing. `answerLessonSuggestion` yes makes a small lesson active or sends a big one for approval; no keeps it as not remembered.
* What I've learned: `listLessons` (owner, supplier, reviewer), `editLesson`, `deleteLesson`, `undoLesson`, `lessonHistory`. Every change is a new revision in `lesson_revisions` with the text, status and effect before and after.
* Talk to correct: `talkToCorrect` reads the message through the free AI chain (task `live_demo`, temperature 0, strict JSON). If no model answers, a plain reader handles "forget that" / "انس ذلك" and "undo" / "تراجع". Replies are fixed lines in English and Arabic.

## Plans and findings
`proposeNextPlan` orders families by lessons first, then by failure history of the last 30 days, then by name. Lessons never add or remove a scenario. The plan stores `lessons_used` with a sentence such as "Last time the reviewer said: ..., so I checked that queue first." The lessons are frozen into the run manifest, so later edits never change a past run. Findings from that run name the lesson in `findings.lessons_used`.

Live check: `scripts/memory-check.mjs` prints `LESSON_CHANGED_PLAN` and `LESSON_NAMED_IN_FINDING`.
