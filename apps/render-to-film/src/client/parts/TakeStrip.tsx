import { Check, Play, Plus } from 'lucide-react';
import { memo, type CSSProperties, type ReactNode } from 'react';

import { StatusDot, Text, Tooltip } from '../kit.ts';
import { Elapsed } from './Elapsed.tsx';
import styles from './TakeStrip.module.css';

export type TakeState = 'queued' | 'rendering' | 'ready' | 'failed' | 'lost';

export type TakeStripItem = {
  id: string;
  kind: 'still' | 'clip';
  /** The take's picture (a clip: the still it starts on). */
  thumb?: string | undefined;
  title: string;
  state: TakeState;
  /** Width over height, so the thumbnail keeps the take's shape. */
  ratio?: number | undefined;
  progress?: number | undefined;
  /** When it started (ms), for the running clock. */
  since?: number | undefined;
  /** Replaces the time under a finished take ("Upscaling"). */
  note?: string | undefined;
};

export type TakeStripProps = {
  label: string;
  items: readonly TakeStripItem[];
  /** The take on the stage, or null for the next one being set up. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** The take being set up, first in the strip. */
  next?: { thumb?: string | undefined; title: string; ratio?: number | undefined } | undefined;
  /** Ticked for compare. */
  ticked?: ReadonlySet<string> | undefined;
  onTick?: ((id: string) => void) | undefined;
  /** Actions at the strip's end: "Compare 3", "Clear finished". */
  actions?: ReactNode | undefined;
};

const STATE_TEXT: Record<TakeState, string> = {
  queued: 'Waiting in line',
  rendering: 'Being made',
  ready: 'Ready',
  failed: "Didn't render",
  lost: 'Lost touch',
};

const STATE_DOT: Record<TakeState, 'success' | 'warning' | 'error' | 'accent' | 'neutral'> = {
  queued: 'neutral',
  rendering: 'accent',
  ready: 'success',
  failed: 'error',
  lost: 'warning',
};

/** Every take of this session, newest first: click one to put it on the stage, tick two to four to compare. */
export const TakeStrip = memo(function TakeStrip({
  label,
  items,
  value,
  onChange,
  next,
  ticked,
  onTick,
  actions,
}: TakeStripProps) {
  return (
    <div className={styles.strip}>
      <div className={styles.head}>
        <Text type="label">{label}</Text>
        <Text type="supporting" hasTabularNumbers>
          {items.length === 0 ? 'None yet' : `${items.length} ${items.length === 1 ? 'take' : 'takes'}`}
        </Text>
        <div className={styles.headActions}>{actions}</div>
      </div>
      <ul className={styles.row} aria-label={label}>
        {next && (
          <li className={styles.cell}>
            <button
              type="button"
              className={styles.card}
              aria-pressed={value === null}
              aria-label={`Next take: ${next.title}`}
              onClick={() => onChange(null)}
            >
              <span className={styles.thumb} style={{ '--r': next.ratio ?? 16 / 9 } as CSSProperties}>
                {next.thumb && <img src={next.thumb} alt="" loading="lazy" />}
                <span className={styles.nextMark} aria-hidden>
                  <Plus size={16} />
                </span>
              </span>
              <span className={styles.caption}>Next take</span>
            </button>
          </li>
        )}
        {items.map((item) => {
          const working = item.state === 'rendering' || item.state === 'queued';
          const isTicked = ticked?.has(item.id) ?? false;
          return (
            <li key={item.id} className={styles.cell}>
              <button
                type="button"
                className={styles.card}
                aria-pressed={value === item.id}
                aria-label={`${item.title}, ${STATE_TEXT[item.state].toLowerCase()}`}
                onClick={() => onChange(item.id)}
              >
                <span className={styles.thumb} style={{ '--r': item.ratio ?? 16 / 9 } as CSSProperties}>
                  {item.thumb && <img src={item.thumb} alt="" loading="lazy" data-dim={working || undefined} />}
                  {item.kind === 'clip' && item.state === 'ready' && (
                    <span className={styles.play} aria-hidden>
                      <Play size={12} />
                    </span>
                  )}
                  {working && (
                    <span className={styles.bar} aria-hidden>
                      <span
                        className={item.progress && item.progress > 0 ? styles.fill : styles.sweep}
                        style={item.progress && item.progress > 0 ? { width: `${Math.round(item.progress * 100)}%` } : undefined}
                      />
                    </span>
                  )}
                </span>
                <span className={styles.caption}>
                  <span className={styles.dot}>
                    <StatusDot
                      variant={STATE_DOT[item.state]}
                      label={STATE_TEXT[item.state]}
                      tooltip={STATE_TEXT[item.state]}
                      isPulsing={item.state === 'rendering'}
                    />
                  </span>
                  <span className={`${styles.time} num`}>
                    {working ? <Elapsed runKey={item.id} since={item.since} /> : (item.note ?? timeOf(item.since))}
                  </span>
                </span>
              </button>
              {onTick && item.state === 'ready' && (
                <Tooltip content={isTicked ? 'Untick' : 'Tick to compare'}>
                  <button
                    type="button"
                    className={styles.tick}
                    aria-pressed={isTicked}
                    aria-label={`Compare ${item.title}`}
                    onClick={() => onTick(item.id)}
                  >
                    {isTicked && <Check size={12} aria-hidden />}
                  </button>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
});

function timeOf(ms: number | undefined): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
