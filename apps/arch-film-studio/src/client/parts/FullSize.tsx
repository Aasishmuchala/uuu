import { Maximize2 } from 'lucide-react';
import { useState } from 'react';

import { Button, IconButton, Lightbox } from '../kit.ts';

export type FullSizeMedia = {
  /** The app's own address of the still or clip. */
  src: string;
  kind: 'still' | 'clip';
  alt: string;
  caption: string;
};

/**
 * The still or clip at full size inside the app, never in a new window: the
 * home screen frames the app without popups (a popup is a way off this Mac).
 * Stills zoom to 100% and pan. Escape or Close backs out; download stays its
 * own link.
 */
export function FullSizeView({ media, onClose }: { media: FullSizeMedia | null; onClose: () => void }) {
  return (
    <Lightbox
      isOpen={media !== null}
      onOpenChange={(open: boolean) => !open && onClose()}
      media={media ? { type: media.kind === 'clip' ? 'video' : 'image', src: media.src, alt: media.alt, caption: media.caption } : { type: 'image', src: '', alt: '' }}
      hasZoom={media?.kind !== 'clip'}
      hasAutoPlay={media?.kind === 'clip'}
    />
  );
}

/** "Open full size": a button and its view. */
export function FullSize({ media, compact }: { media: FullSizeMedia; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <IconButton label="Open full size" tooltip="Full size (F)" variant="ghost" size="sm" icon={<Maximize2 size={15} aria-hidden />} onClick={() => setOpen(true)} />
      ) : (
        <Button label="Open full size" variant="ghost" size="sm" icon={<Maximize2 size={15} aria-hidden />} onClick={() => setOpen(true)} />
      )}
      <FullSizeView media={open ? media : null} onClose={() => setOpen(false)} />
    </>
  );
}
