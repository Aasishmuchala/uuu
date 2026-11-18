# useScrollOverflow
Category: layout.
Import: import { useScrollOverflow } from '@astryxdesign/core';

Tracks scroll overflow state for horizontally scrollable container. Returns ref callback + state booleans that update as user scrolls / container resizes. Uses scroll event listeners + ResizeObserver for reactive updates. Tolerance of 1px applied to avoid sub-pixel false positives.

## Do
- Use to show/hide scroll navigation buttons / fade edges on carousels + horizontal lists.
- Apply scrollRef to container w/ overflow-x: auto / overflow-x: scroll.

## Do not
- Use for vertical scroll tracking; this hook only measures horizontal overflow.

## See also
- Carousel
- useOverflow
