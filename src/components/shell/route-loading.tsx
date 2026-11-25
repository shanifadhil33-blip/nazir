'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { ShellLoading } from './loading';
import { loadingShape } from './loading-shape';

/** The loading convention has no props. Read only public URL hints for its neutral silhouette. */
export function RouteShellLoading() {
  const pathname = usePathname();
  const search = useSearchParams();
  return <ShellLoading {...loadingShape(pathname, search)} />;
}
