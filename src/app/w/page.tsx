import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { runtimeDriver } from '@/server/db/runtime';
import { ensureHomeWorkspace } from '@/server/auth/workspaces';

export const dynamic = 'force-dynamic';

export default async function WorkspacesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/api/auth/signin?callbackUrl=/');
  const workspaceId = await ensureHomeWorkspace(runtimeDriver(), session.user.id);
  redirect(`/w/${workspaceId}`);
}
