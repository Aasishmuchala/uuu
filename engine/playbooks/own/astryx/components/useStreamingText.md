# useStreamingText
Category: streaming.
Import: import { useStreamingText } from '@astryxdesign/core';

Smooths bursty streamed text into steady character-by-character reveal using requestAnimationFrame. Decouples arrival rate from display rate. Advances on word + syntax boundaries to avoid slicing mid-markdown / mid-word, preventing visual glitches w/ markdown renderers. Animation timing derives from Astryx motion tokens via useTheme when available, w/ sensible fallbacks outside theme provider. Snaps to full text when isStreaming becomes false.

## Do
- Pass accumulated text (not individual chunks) as targetText; hook handles incremental reveal internally.
- Set isStreaming to false when stream completes to snap to final text.
- Use speed='instant' for non-animated contexts like search results / when reduced motion preferred.

## Do not
- Use for static text that does not change; hook adds unnecessary overhead for non-streaming content.

## See also
- Markdown
