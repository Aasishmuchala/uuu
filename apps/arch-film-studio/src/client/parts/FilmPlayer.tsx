import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { IconButton } from '../kit.ts';
import { clipAt, clipStarts, clock } from '../lib/timeline.ts';
import styles from './FilmPlayer.module.css';

export type PlayerClip = {
  /** The clip's own address under /files/. */
  src: string;
  seconds: number;
  label: string;
};

/**
 * One video element for the film: before it is assembled it plays the
 * approved clips one after the other, straight from their files (the next
 * starts when one ends); after, the finished film. A scrub bar with a mark at
 * each shot. Nothing is read into memory: the element streams each file.
 */
export function FilmPlayer({ clips, ratio, label, maxHeight = '62vh' }: { clips: PlayerClip[]; ratio: number; label: string; maxHeight?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [local, setLocal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const pendingSeek = useRef<number | null>(null);
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const durations = clips.map((c) => measured[c.src] ?? c.seconds);
  const starts = clipStarts(durations);
  const total = durations.reduce((a, b) => a + b, 0);
  const clipKey = clips.map((c) => c.src).join('|');
  const current = clips[Math.min(index, clips.length - 1)];

  // A new set of clips starts again from the top.
  useEffect(() => {
    setIndex(0);
    setLocal(0);
    setPlaying(false);
    pendingSeek.current = null;
  }, [clipKey]);

  if (!current) return null;
  const at = (starts[index] ?? 0) + local;

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      if (index === clips.length - 1 && v.ended) {
        pendingSeek.current = 0;
        setIndex(0);
        setLocal(0);
      } else void v.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  };

  const seek = (t: number) => {
    const { index: i, local: l } = clipAt(durations, t);
    setLocal(l);
    if (i === index && video.current) video.current.currentTime = l;
    else {
      pendingSeek.current = l;
      setIndex(i);
    }
  };

  return (
    <div className={styles.player}>
      <div className={styles.screen} style={{ ['--ar' as string]: String(ratio), ['--max-h' as string]: maxHeight }}>
        <video
          ref={video}
          className={styles.video}
          src={current.src}
          preload="metadata"
          playsInline
          aria-label={`${label}: ${current.label}`}
          onClick={toggle}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration) && v.duration > 0) setMeasured((m) => (m[current.src] === v.duration ? m : { ...m, [current.src]: v.duration }));
            if (pendingSeek.current !== null) {
              v.currentTime = pendingSeek.current;
              pendingSeek.current = null;
            }
            if (playing) void v.play().catch(() => setPlaying(false));
          }}
          onTimeUpdate={(e) => setLocal(e.currentTarget.currentTime)}
          onEnded={() => {
            if (index < clips.length - 1) {
              setIndex(index + 1);
              setLocal(0);
            } else setPlaying(false);
          }}
        />
        {clips.length > 1 && (
          <span className={styles.shotTag} aria-hidden>
            {current.label}
          </span>
        )}
      </div>
      <div className={styles.controls}>
        <IconButton
          label={playing ? 'Pause' : 'Play'}
          variant="ghost"
          size="sm"
          icon={playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          onClick={toggle}
        />
        <div className={styles.scrub}>
          <div className={styles.track} aria-hidden>
            <div className={styles.fill} style={{ width: `${total > 0 ? (at / total) * 100 : 0}%` }} />
            {clips.length > 1 &&
              starts.slice(1).map((s, i) => (
                <span key={i} className={styles.mark} style={{ left: `${total > 0 ? (s / total) * 100 : 0}%` }} />
              ))}
          </div>
          <input
            className={styles.range}
            type="range"
            min={0}
            max={Math.max(0.1, total)}
            step={0.1}
            value={Math.min(at, total)}
            aria-label={`Position in ${label}`}
            aria-valuetext={`${clock(at)} of ${clock(total)}`}
            onChange={(e) => seek(Number(e.target.value))}
          />
        </div>
        <span className={`${styles.time} num`}>
          {clock(at)} / {clock(total)}
        </span>
      </div>
    </div>
  );
}
