import { expect, it } from 'vitest';
import { messagesFor, settingsError } from '../../src/components/ocean/copy';
import { errorLines } from '../../src/server/http/errors';

it.each(['en', 'ar'] as const)('maps URL safety codes to specific %s copy even when the API sends a generic message', (lang) => {
  const copy = messagesFor(lang);
  for (const code of ['external_private_address', 'external_safety'] as const) {
    expect(settingsError({ error: { code, message: errorLines.validation[lang] } }, copy, copy.settings.failed)).toBe(errorLines[code][lang]);
  }
});

it.each(['en', 'ar'] as const)('keeps the supplied %s fallback for unrelated or missing errors', (lang) => {
  const copy = messagesFor(lang);
  for (const payload of [null, {}, { error: { code: 'validation' } }]) {
    expect(settingsError(payload, copy, copy.settings.failed)).toBe(copy.settings.failed);
  }
});
