# useOverflow
Category: layout.
Import: import { useOverflow } from '@astryxdesign/core';

Measures children rendered in hidden container to determine how many fit in available width w/o flickering. Uses ResizeObserver to react to container and measured-child size changes. Measurement container should hold all items plus optional overflow indicator element (identified by data-overflow-indicator attribute).

## Do
- Render all items into measureRef container (hidden) + only first visibleCount items into containerRef container (visible).
- Include overflow indicator (e.g. "+N more" button) as last child of measurement container w/ data-overflow-indicator attribute.

## Do not
- Use for vertical overflow; this hook measures horizontal width only.

## See also
- OverflowList
- Breadcrumb
- useScrollOverflow
