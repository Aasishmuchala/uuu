import { useEffect, useRef, useState } from 'react';

/** Seconds since `since` (or since mount), ticking once a second while the page is visible. */
export function Elapsed({ runKey, since }: { runKey?: string | undefined; since?: number | undefined }) {
  const start = useRef(since ?? Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    start.current = since ?? Date.now();
    setNow(Date.now());
  }, [runKey, since]);
  useEffect(() => {
    const t = setInterval(() => {
      // A hidden tab has nothing to show; skip the work.
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.round((now - start.current) / 1000));
  return <>{seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}</>;
}
