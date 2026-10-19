import type { DefaultSession } from 'next-auth';
import type { Membership } from '../server/auth/shape';
declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & { id: string };
    memberships: Membership[];
  }
}
