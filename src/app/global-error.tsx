'use client';

import { RecoveryScreen } from '@/components/recovery-screen';

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return <html lang="en" suppressHydrationWarning><body style={{ margin: 0 }}>
    <RecoveryScreen retry={retry} />
  </body></html>;
}
