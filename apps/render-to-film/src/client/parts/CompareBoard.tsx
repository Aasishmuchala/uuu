import { Pause, Play, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent } from 'react';

import { Button, Dialog, DialogHeader, IconButton, Text } from '../kit.ts';
import styles from './CompareBoard.module.css';

export type CompareItem = {
  id: string;
  kind: 'still' | 'clip';
  /** The picture at full size, or the clip's own address. */
  src: string;
  /** A clip's poster (the still it starts on). */
  poster?: string | undefined;
  title: string;
  /** How it was made, one line. */
  detail?: string | undefined;
  ratio: number;
};

export type CompareBoardProps = {
  items: readonly CompareItem[];
  isOpen: boolean;
  onClose: () => void;
  /** "Pick" on each: what picking does is the screen's (star it, put it on the stage). */
  onPick?: ((id: string) => void) | undefined;
  pickLabel?: string | undefined;
};

const MIN = 1;
const MAX = 8;

/**
 * Two to four stills side by side with one zoom and pan for all, or two clips that play,
 * pause and scrub together. Reads files the app already serves; it spends nothing.
 */
export function CompareBoard({ items, isOpen, onClose, onPick, pickLabel = 'Pick' }: CompareBoardProps) {
  const clips = items.length > 0 && items.every((i) => i.kind === 'clip');
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open: boolean) => !open && onClose()}
      variant="fullscreen"
      padding={0}
    >
      <div className={styles.board}>
        <div className={styles.header}>
          <DialogHeader
            title={clips ? 'Compare two videos' : `Compare ${items.length} stills`}
            subtitle={
              clips
                ? 'Both play, pause and scrub together.'
                : 'Scroll to zoom and drag to move. Every still moves with the others.'
            }
            onOpenChange={(open: boolean) => !open && onClose()}
            hasDivider={false}
          />
        </div>
        {clips ? (
          <ClipPair items={items} onPick={onPick} pickLabel={pickLabel} />
        ) : (
          <StillBoard items={items} onPick={onPick} pickLabel={pickLabel} />
        )}
      </div>
    </Dialog>
  );
}

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

function StillBoard({
  items,
  onPick,
  pickLabel,
}: {
  items: readonly CompareItem[];
  onPick?: ((id: string) => void) | undefined;
  pickLabel: string;
}) {
  const [view, setView] = useState<View>(FIT);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const zoomBy = (factor: number) =>
    setView((v) => {
      const scale = Math.min(MAX, Math.max(MIN, v.scale * factor));
      return scale === MIN ? FIT : { scale, x: (v.x * scale) / v.scale, y: (v.y * scale) / v.scale };
    });
  const onWheel = (e: WheelEvent) => zoomBy(Math.exp(-e.deltaY * 0.0015));
  const onPointerDown = (e: PointerEvent) => {
    if (view.scale === MIN || e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { id: d.id, x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  return (
    <>
      <div className={styles.tools}>
        <IconButton label="Zoom out" tooltip="Zoom out" variant="ghost" size="sm" icon={<ZoomOut size={16} />} onClick={() => zoomBy(1 / 1.5)} isDisabled={view.scale === MIN} />
        <Text type="supporting" hasTabularNumbers>
          {Math.round(view.scale * 100)}%
        </Text>
        <IconButton label="Zoom in" tooltip="Zoom in" variant="ghost" size="sm" icon={<ZoomIn size={16} />} onClick={() => zoomBy(1.5)} isDisabled={view.scale === MAX} />
        <Button label="Fit" variant="ghost" size="sm" onClick={() => setView(FIT)} isDisabled={view.scale === MIN} />
      </div>
      <div className={styles.grid} data-count={items.length}>
        {items.map((it) => (
          <figure key={it.id} className={styles.pane}>
            <div
              className={styles.viewport}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={() => setView(FIT)}
              data-zoomed={view.scale > MIN || undefined}
            >
              <img
                src={it.src}
                alt={it.title}
                draggable={false}
                style={{ transform, aspectRatio: String(it.ratio) } as CSSProperties}
              />
            </div>
            <figcaption className={styles.caption}>
              <span className={styles.captionText}>
                <Text type="label" maxLines={1}>
                  {it.title}
                </Text>
                {it.detail && (
                  <Text type="supporting" maxLines={1}>
                    {it.detail}
                  </Text>
                )}
              </span>
              {onPick && <Button label={pickLabel} size="sm" variant="secondary" onClick={() => onPick(it.id)} />}
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}

function ClipPair({
  items,
  onPick,
  pickLabel,
}: {
  items: readonly CompareItem[];
  onPick?: ((id: string) => void) | undefined;
  pickLabel: string;
}) {
  const refs = useRef<Array<HTMLVideoElement | null>>([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const lead = () => refs.current[0] ?? null;

  useEffect(() => {
    const a = lead();
    if (!a) return;
    const follow = () => {
      setTime(a.currentTime);
      for (const v of refs.current.slice(1)) {
        if (v && Math.abs(v.currentTime - a.currentTime) > 0.15) v.currentTime = a.currentTime;
      }
    };
    const meta = () => setDuration(Math.max(...refs.current.map((v) => (v && Number.isFinite(v.duration) ? v.duration : 0))));
    const ended = () => setPlaying(false);
    a.addEventListener('timeupdate', follow);
    a.addEventListener('ended', ended);
    for (const v of refs.current) v?.addEventListener('loadedmetadata', meta);
    return () => {
      a.removeEventListener('timeupdate', follow);
      a.removeEventListener('ended', ended);
      for (const v of refs.current) v?.removeEventListener('loadedmetadata', meta);
    };
  }, [items]);

  const toggle = () => {
    const vids = refs.current.filter((v): v is HTMLVideoElement => v !== null);
    if (playing) {
      for (const v of vids) v.pause();
      setPlaying(false);
    } else {
      const at = lead()?.currentTime ?? 0;
      for (const v of vids) {
        v.currentTime = at;
        void v.play().catch(() => setPlaying(false));
      }
      setPlaying(true);
    }
  };
  const seek = (t: number) => {
    for (const v of refs.current) if (v) v.currentTime = t;
    setTime(t);
  };

  return (
    <>
      <div className={styles.grid} data-count={items.length}>
        {items.map((it, i) => (
          <figure key={it.id} className={styles.pane}>
            <div className={styles.viewport}>
              <video
                ref={(el) => {
                  refs.current[i] = el;
                }}
                src={it.src}
                poster={it.poster}
                muted
                playsInline
                preload="auto"
                aria-label={it.title}
                style={{ aspectRatio: String(it.ratio) }}
              />
            </div>
            <figcaption className={styles.caption}>
              <span className={styles.captionText}>
                <Text type="label" maxLines={1}>
                  {it.title}
                </Text>
                {it.detail && (
                  <Text type="supporting" maxLines={1}>
                    {it.detail}
                  </Text>
                )}
              </span>
              {onPick && <Button label={pickLabel} size="sm" variant="secondary" onClick={() => onPick(it.id)} />}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className={styles.transport}>
        <IconButton
          label={playing ? 'Pause both' : 'Play both'}
          tooltip={playing ? 'Pause both' : 'Play both'}
          variant="secondary"
          icon={playing ? <Pause size={16} /> : <Play size={16} />}
          onClick={toggle}
        />
        <input
          className={styles.scrub}
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(time, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Scrub both videos"
        />
        <Text type="supporting" hasTabularNumbers>
          {clock(time)} of {clock(duration)}
        </Text>
      </div>
    </>
  );
}

function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const sec = t % 60;
  return `${Math.floor(t / 60)}:${sec < 10 ? `0${sec}` : sec}`;
}
