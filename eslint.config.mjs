import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'coverage/**', 'e2e/**', 'next-env.d.ts', '.gate-audit*/**', '.pnpm-store/**', '.pnpm-cache/**', '.pnpm-state/**']),
]);
