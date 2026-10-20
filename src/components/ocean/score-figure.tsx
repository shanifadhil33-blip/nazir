'use client';

import { useLayoutEffect, useRef, useState } from 'react';

/** Ease out cubic. t is 0 at the start and 1 at the end. */
export function countAt(target: number, t: number, from = 0) {
  const clamped = Math.min(1, Math.max(0, t));
  const eased = 1 - (1 - clamped) ** 3;
  return Math.round(from + (target - from) * eased);
}

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useScoreCount(value: number) {
  const animate = typeof requestAnimationFrame === 'function' && !reducedMotion();
  const [shown, setShown] = useState(value);
  if (!animate && shown !== value) setShown(value);
  const fromRef = useRef(0);
  useLayoutEffect(() => {
    if (!animate) {
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setShown(countAt(value, t, from));
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    // Start from the previous value before paint so the final number does not flash.
    setShown(from);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, value]);
  return shown;
}

export function ScoreFigure({ value, ring = 'coral', named = false, compact = false, caption }: { value: number; ring?: 'coral' | 'teal'; named?: boolean; compact?: boolean; caption?: string }) {
  const shown = useScoreCount(value);
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, shown)) / 100);
  return (
    <div className={named ? 'nz-score-named' : undefined} data-score-final={value}>
      <div className={compact ? 'nz-score-row' : 'nz-score-block'}>
        <div>
          <p className="nz-score-num">{shown}</p>
          {caption ? <p className="nz-out">{caption}</p> : null}
        </div>
        <svg className="nz-ring" viewBox="0 0 56 56" aria-hidden="true">
          <circle className="nz-ring-track" cx="28" cy="28" r={radius} />
          <circle className={`nz-ring-value is-${ring}`} cx="28" cy="28" r={radius} strokeDasharray={circumference} strokeDashoffset={offset} />
        </svg>
      </div>
    </div>
  );
}
