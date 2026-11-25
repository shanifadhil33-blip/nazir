import { Suspense } from 'react';
import { ShellLoading } from '@/components/shell/loading';
import { RouteShellLoading } from '@/components/shell/route-loading';

export default function Loading() {
  return <Suspense fallback={<ShellLoading />}><RouteShellLoading /></Suspense>;
}
