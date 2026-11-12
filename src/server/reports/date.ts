import type { ReportBody } from './build';

/** The check ended first, otherwise began, otherwise the legacy report was saved. */
export function checkDate(createdAt: string, body: ReportBody): Date {
  return new Date(body.run.finished_at ?? body.run.started_at ?? createdAt);
}
