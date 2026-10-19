import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { 'server-only': new URL('./tests/helpers/server-only.ts', import.meta.url).pathname, '@': new URL('./src', import.meta.url).pathname } },
  test: { server: { deps: { inline: ['next-auth', '@auth/core'] } }, environment: 'node', maxWorkers: 2, testTimeout: 30000, hookTimeout: 30000, include: ['tests/**/*.test.{ts,tsx}'] },
});
