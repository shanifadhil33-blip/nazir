import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Coded, Forbidden, NotFound, TooMany, Unauthorized, errorLines, errorResponse, mapError, type ErrorCode } from '../../src/server/http/errors';

const codes = Object.keys(errorLines) as ErrorCode[];

it('gives every error code its own line in English and Arabic', () => {
  const english = codes.map((code) => errorLines[code].en);
  expect(new Set(english).size).toBe(english.length);
  for (const code of codes) {
    const en = mapError(new Coded(400, code, 'x'), 'en');
    const ar = mapError(new Coded(400, code, 'x'), 'ar');
    expect(en.body.error).toEqual({ code, message: errorLines[code].en });
    expect(ar.body.error).toEqual({ code, message: errorLines[code].ar });
    expect(ar.body.error.message).toMatch(/[\u0600-\u06FF]/);
    expect(`${en.body.error.message} ${ar.body.error.message}`).not.toMatch(/ - |\u2013|\u2014/);
  }
});
it('maps the shared refusals in the caller language', () => {
  expect(mapError(new Unauthorized(), 'ar').body.error).toEqual({ code: 'unauthorized', message: errorLines.unauthorized.ar });
  expect(mapError(new Forbidden(), 'en').body.error).toEqual({ code: 'forbidden', message: 'You cannot do this.' });
  expect(mapError(new NotFound(), 'ar').body.error.code).toBe('not_found');
  expect(mapError(new TooMany('You can belong to at most 10 workspaces. Remove one to add another.'), 'ar').body.error).toEqual({ code: 'workspace_limit', message: errorLines.workspace_limit.ar });
  expect(mapError(new TooMany(), 'en').body.error.code).toBe('too_many');
  expect(mapError(new z.ZodError([]), 'ar').body.error).toEqual({ code: 'validation', message: errorLines.validation.ar });
  const impersonation = new Coded(403, 'impersonation', errorLines.impersonation.en);
  expect(impersonation.message).toBe('You cannot act as another member.');
  expect(mapError(impersonation, 'ar').body.error).toEqual({ code: 'impersonation', message: errorLines.impersonation.ar });
  expect(mapError(new Coded(409, 'custom_thing', 'secret detail'), 'en').body.error).toEqual({ code: 'failed', message: errorLines.failed.en });
});

it('sends the next UTC day for real daily caps, without a false reset for a temporary refusal', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-16T23:59:40Z'));
    expect(errorResponse(new Coded(429, 'daily_run_cap', 'x')).headers.get('x-nazir-limit-reset')).toBe('2026-11-17T00:00:00.000Z');
    expect(errorResponse(new Coded(429, 'too_many', 'x')).headers.has('x-nazir-limit-reset')).toBe(false);
  } finally { vi.useRealTimers(); }
});
