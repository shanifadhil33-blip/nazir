import NextAuth, { type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { createAuthAdapter } from './server/auth/adapter';
import { sessionShape } from './server/auth/shape';
import { runtimeDriver } from './server/db/runtime';
export const authConfig = {
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  adapter: createAuthAdapter(),
  providers: [Google({ clientId: process.env.AUTH_GOOGLE_ID ?? '', clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '', authorization: { params: { scope: 'openid email profile', prompt: 'select_account' } } })],
  session: { strategy: 'database', maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    async signIn() { return process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.AUTH_SECRET ? true : '/api/auth/error?error=Configuration'; },
    async session({ session, user }) { return { ...session, ...await sessionShape(runtimeDriver(), user) }; },
  },
  logger: { error() { console.error('Sign in failed. Check the sign in settings and try again.'); } },
} satisfies NextAuthConfig;
const nextAuth = NextAuth(authConfig);
export const { auth, signOut } = nextAuth;
export const handlers = {
  async GET(request: Parameters<typeof nextAuth.handlers.GET>[0]) {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/providers') && (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET || !process.env.AUTH_SECRET)) {
      return Response.json({ google: { id: 'google', name: 'Google', type: 'oidc', signinUrl: new URL('/api/auth/signin/google', request.url).href, callbackUrl: new URL('/api/auth/callback/google', request.url).href } });
    }
    if ((path.endsWith('/signin/google') || path.endsWith('/callback/google')) && (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET || !process.env.AUTH_SECRET)) {
      return Response.json({ error: { code: 'auth_not_configured', message: 'Google sign in is not configured yet.' } }, { status: 503 });
    }
    return nextAuth.handlers.GET(request);
  },
  async POST(request: Parameters<typeof nextAuth.handlers.POST>[0]) {
    if (new URL(request.url).pathname.endsWith('/signin/google') && (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET || !process.env.AUTH_SECRET)) {
      return Response.json({ error: { code: 'auth_not_configured', message: 'Google sign in is not configured yet.' } }, { status: 503 });
    }
    return nextAuth.handlers.POST(request);
  },
};
export const signIn: typeof nextAuth.signIn = async (...args) => {
  if (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET || !process.env.AUTH_SECRET) throw new Error('Google sign in is not configured yet.');
  return nextAuth.signIn(...args);
};
