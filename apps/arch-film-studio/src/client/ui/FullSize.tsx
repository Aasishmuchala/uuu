import { Maximize2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from './Button.tsx';
import { Lightbox } from './Lightbox.tsx';

export type FullSizeProps = {
  /** The app's own address of the still or clip (`libraryUrl`). */
  src: string;
  kind: 'still' | 'clip';
  title: string;
  alt: string;
};

/**
 * "Open full size": the still or clip at full size inside the app, not in a
 * new window. The home screen frames the app without popups (a popup is a
 * way off this Mac), so the view opens over the page; Escape or Close backs
 * out. Download stays its own button.
 */
export function FullSize({ src, kind, title, alt }: FullSizeProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" icon={<Maximize2 size={16} />} onPress={() => setOpen(true)}>
        Open full size
      </Button>
      <Lightbox src={open ? src : null} video={kind === 'clip'} alt={alt} title={title} onClose={() => setOpen(false)} />
    </>
  );
}
