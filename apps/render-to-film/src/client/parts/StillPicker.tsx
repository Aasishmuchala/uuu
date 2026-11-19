import { ImagePlus } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { Still } from '../../api.ts';
import { LOOKS, litFromReference } from '../../looks.ts';
import { Button, Dialog, DialogHeader, EmptyState, SegmentedControl, SegmentedControlItem, Text } from '../kit.ts';
import { stillTitle } from '../lib/titles.ts';
import { stillThumbUrl } from '../lib/urls.ts';
import { ImageDropZone } from '../ui/ImageDropZone.tsx';
import { MediaGrid } from './MediaGrid.tsx';
import styles from './StillPicker.module.css';

const PAGE = 24;

const FILTERS = [
  { id: 'all', name: 'All' },
  { id: 'today', name: 'Today' },
  { id: 'people', name: 'With people' },
  { id: 'night', name: 'Night' },
] as const;
type Filter = (typeof FILTERS)[number]['id'];

export type StillPickerProps = {
  isOpen: boolean;
  title: string;
  /** Finished stills, newest first. */
  stills: readonly Still[];
  /** The still already chosen, outlined. */
  value?: string | null | undefined;
  onPick: (still: Still) => void;
  onClose: () => void;
  /** Also take an image from this Mac (a frame, an extra image). */
  onFile?: ((file: File) => void) | undefined;
};

/** Choose one of your finished stills from the Library's grid, or drop an image. */
export function StillPicker({ isOpen, title, stills, value, onPick, onClose, onFile }: StillPickerProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const filtered = useMemo(() => {
    const today = new Date().toDateString();
    const night = new Set<string>(LOOKS.filter((l) => /night|moon|blue hour/i.test(l.name)).map((l) => l.id));
    return stills.filter((s) =>
      filter === 'today'
        ? new Date(s.createdAt).toDateString() === today
        : filter === 'people'
          ? s.crowd !== 'none'
          : filter === 'night'
            ? !litFromReference(s) && (night.has(s.look) || /night/.test(s.look))
            : true
    );
  }, [stills, filter]);
  const items = filtered.slice(0, shown).map((s) => ({
    id: s.id,
    kind: 'still' as const,
    thumb: stillThumbUrl(s.id),
    title: stillTitle(s),
    ratio: s.width > 0 && s.height > 0 ? s.width / s.height : 16 / 9,
  }));
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && onClose()} width={880} maxHeight="85dvh">
      <DialogHeader title={title} onOpenChange={(open: boolean) => !open && onClose()} />
      <div className={styles.body}>
        {stills.length > 6 && (
          <SegmentedControl
            label="Show"
            size="sm"
            value={filter}
            onChange={(f: string) => {
              setFilter(f as Filter);
              setShown(PAGE);
            }}
          >
            {FILTERS.map((f) => (
              <SegmentedControlItem key={f.id} value={f.id} label={f.name} />
            ))}
          </SegmentedControl>
        )}
        {stills.length === 0 ? (
          <EmptyState
            isCompact
            title="No finished stills yet"
            description={onFile ? 'Drop an image below instead.' : 'Make a still on Stills first. Every finished take shows up here.'}
          />
        ) : filtered.length === 0 ? (
          <Text type="supporting" as="p">
            No stills match this filter.
          </Text>
        ) : (
          <MediaGrid
            label={title}
            density="small"
            items={items}
            active={value ?? null}
            onActivate={(id) => {
              const s = stills.find((x) => x.id === id);
              if (s) onPick(s);
            }}
          />
        )}
        {filtered.length > shown && (
          <div>
            <Button
              label={`Show ${Math.min(PAGE, filtered.length - shown)} more`}
              variant="ghost"
              size="sm"
              onClick={() => setShown((n) => n + PAGE)}
            />
          </div>
        )}
        {onFile && (
          <ImageDropZone onFile={onFile} actionLabel="Upload an image">
            <div className={styles.drop}>
              <ImagePlus size={18} aria-hidden />
              <Text type="supporting">Or drop an image here (PNG, JPEG or WebP)</Text>
            </div>
          </ImageDropZone>
        )}
      </div>
    </Dialog>
  );
}
