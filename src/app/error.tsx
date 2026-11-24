'use client';

import { RecoveryScreen } from '@/components/recovery-screen';

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return <RecoveryScreen retry={retry} />;
}
