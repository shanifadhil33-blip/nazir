import type { NextConfig } from 'next';

const config: NextConfig = {
  turbopack: {},
  outputFileTracingIncludes: {
    '/api/workspaces/*/reports/*/pdf': ['./src/server/reports/fonts/NotoSansArabic.ttf'],
    // The shipped Government tests are read from disk when a new workspace starts its first check.
    '/api/workspaces/*/agent/chat': ['./src/server/library/scenarios/**/*', './src/server/packs/government/**/*'],
    '/api/mcp': ['./src/server/library/scenarios/**/*', './src/server/packs/government/**/*'],
  },
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com; object-src 'none'" },
      ],
    }];
  },
};
export default config;
