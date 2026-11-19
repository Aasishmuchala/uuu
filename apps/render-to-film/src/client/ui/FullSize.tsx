import { Maximize2 } from 'lucide-react';
import { useState } from 'react';

import { Button, IconButton, Lightbox } from '../kit.ts';

export type FullSizeProps = {
  /** The app's own address of the still or clip (`libraryUrl`). */
  src: string;
  kind: 'still' | 'clip';
  title: string;
  alt: string;
  /** A compact icon button for a toolbar ("Open full size" stays its name and tooltip). */
  iconOnly?: boolean | undefined;
  /** Open and close it from outside too (the F key); leave out to let the button own it. */
  isOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
};

/**
 * "Open full size": the still or clip at full size inside the app, not in a
 * new window. The home screen frames the app without popups (a popup is a
 * way off this Mac), so the view opens over the page; Escape or Close backs
 * out. Download stays its own button.
 */
export function FullSize({ src, kind, title, alt, iconOnly = false, isOpen, onOpenChange }: FullSizeProps) {
  const [own, setOwn] = useState(false);
  const open = isOpen ?? own;
  const setOpen = (v: boolean) => {
    setOwn(v);
    onOpenChange?.(v);
  };
  const label = 'Open full size';
  return (
    <>
      {iconOnly ? (
        <IconButton label={label} tooltip={label} variant="ghost" size="sm" icon={<Maximize2 size={16} />} onClick={() => setOpen(true)} />
      ) : (
        <Button label={label} variant="ghost" icon={<Maximize2 size={16} />} onClick={() => setOpen(true)} />
      )}
      <Lightbox
        isOpen={open}
        onOpenChange={setOpen}
        media={{ type: kind === 'clip' ? 'video' : 'image', src, alt, caption: title }}
        hasZoom={kind === 'still'}
        hasAutoPlay={kind === 'clip'}
      />
    </>
  );
}
