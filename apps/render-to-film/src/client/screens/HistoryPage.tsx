import { RotateCcw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { lookLabel } from '../../looks.ts';
import { imageModelName, motionLabel, videoModelName } from '../../models.ts';
import { Button, EmptyState, Heading, Skeleton, Text, TextInput } from '../kit.ts';
import { groupByDay, promptHistory, search, type HistoryEntry } from '../lib/history.ts';
import { clipPreset, savePreset, stillPreset } from '../lib/reuse.ts';
import { ErrorNote } from '../parts/ErrorNote.tsx';
import { trpc } from '../trpc.ts';
import styles from './HistoryPage.module.css';

/** "Golden hour, Nano Banana Pro" or "Slow push in, Seedance 2": the settings in words. */
function settingsOf(e: HistoryEntry): string {
  return e.kind === 'still'
    ? [e.look ? lookLabel(e.look) : 'Lit from a reference', imageModelName(e.model)].join(', ')
    : [e.motion ? motionLabel(e.motion) : '', videoModelName(e.model)].filter(Boolean).join(', ');
}

/**
 * Every direction written here, newest first, by day, with the look, the model and what it made.
 * "Use again" fills Stills or Video with those settings; nothing is sent until the priced button.
 */
export function HistoryPage({ onGo }: { onGo: (screen: 'stills' | 'video') => void }) {
  const library = trpc.library.useQuery(undefined, { refetchOnWindowFocus: false });
  const [text, setText] = useState('');
  const all = useMemo(() => promptHistory(library.data), [library.data]);
  const shown = useMemo(() => search(all, text, settingsOf), [all, text]);
  const days = useMemo(() => groupByDay(shown), [shown]);

  const useAgain = (e: HistoryEntry) => {
    if (e.kind === 'still') {
      const s = library.data?.stills.find((x) => x.id === e.id);
      if (!s) return;
      savePreset('still', stillPreset(s));
      onGo('stills');
    } else {
      const c = library.data?.clips.find((x) => x.id === e.id);
      if (!c) return;
      savePreset('clip', clipPreset(c));
      onGo('video');
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.titles}>
          <Heading level={1}>History</Heading>
          <Text type="supporting">Every direction you have written. A direction that worked is worth more than the take.</Text>
        </div>
        {all.length > 0 && (
          <div className={styles.search}>
            <TextInput
              type="search"
              label="Search your directions"
              isLabelHidden
              placeholder="Search your directions"
              value={text}
              onChange={setText}
              startIcon={Search}
              hasClear
              width="100%"
            />
          </div>
        )}
      </header>

      {library.isPending ? (
        <div className={styles.list}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.row}>
              <div className={styles.thumb}>
                <Skeleton index={i} radius={1} />
              </div>
              <div className={styles.body}>
                <Skeleton height={14} width="70%" index={i} />
                <Skeleton height={12} width="40%" index={i} />
              </div>
            </div>
          ))}
        </div>
      ) : library.error && !library.data ? (
        <div className={styles.list}>
          <ErrorNote error={library.error} action={<Button label="Try again" size="sm" onClick={() => void library.refetch()} />} />
        </div>
      ) : all.length === 0 ? (
        <div className={styles.empty}>
          <EmptyState
            title="No directions yet"
            description="When you write an extra direction on Stills or Video, it is kept here with what it made."
            actions={<Button label="Go to Stills" variant="primary" onClick={() => onGo('stills')} />}
          />
        </div>
      ) : shown.length === 0 ? (
        <div className={styles.empty}>
          <EmptyState
            title="Nothing matches"
            description="Try other words."
            actions={<Button label="Clear the search" onClick={() => setText('')} />}
          />
        </div>
      ) : (
        <div className={styles.list}>
          {days.map((d) => (
            <section key={d.day} className={styles.day} aria-labelledby={`day-${d.day}`}>
              <Heading level={3} id={`day-${d.day}`}>
                {d.label}
              </Heading>
              <ol className={styles.entries}>
                {d.entries.map((e) => (
                  <li key={`${e.kind}:${e.id}`} className={styles.row}>
                    <div className={styles.thumb}>
                      <img src={e.thumb} alt="" loading="lazy" />
                    </div>
                    <div className={styles.body}>
                      <Text as="p" maxLines={3}>
                        {e.direction}
                      </Text>
                      <Text type="supporting" hasTabularNumbers>
                        {e.kind === 'still' ? 'Still' : 'Video'}, {settingsOf(e)},{' '}
                        {new Date(e.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        {e.count > 1 ? `. Used ${e.count} times` : ''}
                      </Text>
                    </div>
                    <div className={styles.action}>
                      <Button
                        label="Use again"
                        size="sm"
                        icon={<RotateCcw size={14} />}
                        tooltip={`Fill ${e.kind === 'still' ? 'Stills' : 'Video'} with these settings. Nothing is made until you press its button.`}
                        onClick={() => useAgain(e)}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
