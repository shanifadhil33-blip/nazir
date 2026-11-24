'use client';

import { ViewTransition, type ReactNode } from 'react';

/** Crossfades one signed-in screen into the next. The shell chrome keeps its own transition name and stays put. */
export function ScreenFade({ screen, children }: { screen: string; children: ReactNode }) {
  return (
    <ViewTransition key={screen} name="nz-screen" share="nz-fade" enter="nz-fade" exit="nz-fade" default="none" update="none">
      {children}
    </ViewTransition>
  );
}
