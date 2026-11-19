import { memo, type ReactNode, useEffect, useRef, useState } from 'react';

import { AspectRatio, ProgressBar } from '../kit.ts';
import styles from './Picture.module.css';

export type Working = {
  /** "Being made 40%", "Waiting for a free place". */
  words: string;
  /** 0 to 1, when the model reports it. */
  progress?: number | undefined;
  /** When the work started (ms), so the clock survives a reload. */
  since?: number | undefined;
};

/**
 * One picture at its true ratio on the darker well, never cropped. While it
 * is being made, the progress sits on the picture's own frame; a failure is a
 * sentence in the frame.
 */
export function Picture({
  src,
  alt,
  width,
  height,
  working,
  error,
  children,
  eager,
  well,
}: {
  src?: string | undefined;
  alt: string;
  width: number;
  height: number;
  working?: Working | null | undefined;
  error?: string | null | undefined;
  /** Drawn over the picture (a caption on a scrim). */
  children?: ReactNode;
  eager?: boolean | undefined;
  /** A cell of one shape for every picture of a contact sheet: the picture sits whole inside it. */
  well?: number | undefined;
}) {
  const ratio = well ?? (width > 0 && height > 0 ? width / height : 16 / 9);
  return (
    <AspectRatio ratio={ratio}>
      <div className={styles.frame}>
        {src && <img className={styles.img} src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} draggable={false} />}
        {working && <WorkingOverlay working={working} hasPicture={!!src} />}
        {error && !working && (
          <div className={styles.failed} role="alert">
            {error}
          </div>
        )}
        {children}
      </div>
    </AspectRatio>
  );
}

const WorkingOverlay = memo(function WorkingOverlay({ working, hasPicture }: { working: Working; hasPicture: boolean }) {
  const pct = typeof working.progress === 'number' && working.progress > 0 && working.progress < 1 ? working.progress : null;
  return (
    <div className={styles.working} data-over={hasPicture || undefined}>
      <div className={styles.workingText}>
        <span role="status" aria-live="polite">
          {working.words}
        </span>
        <span className={`${styles.elapsed} num`} aria-hidden>
          <Elapsed since={working.since} />
        </span>
      </div>
      <div className={styles.bar}>
        <ProgressBar
          label={working.words}
          isLabelHidden
          isIndeterminate={pct === null}
          value={pct === null ? 0 : Math.round(pct * 100)}
          max={100}
        />
      </div>
    </div>
  );
});

/** "42 s", "3 min 5 s", "2 h 4 min". */
export function elapsedWords(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
}

/** Seconds since the work started; only this text redraws each second. */
export function Elapsed({ since }: { since?: number | undefined }) {
  const start = useRef(since ?? Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    start.current = since ?? Date.now();
    setNow(Date.now());
  }, [since]);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.round((now - start.current) / 1000));
  return <>{elapsedWords(seconds)}</>;
}
