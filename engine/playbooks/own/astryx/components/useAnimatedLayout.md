# useAnimatedLayout
Category: motion & gestures.
Import: import { useAnimatedLayout } from '@astryxdesign/core';

Handle for a component whose size changes (TreeList, Collapsible): it + content after it inside containerRef glide on one shared motion role. Fixed/stuck sticky stay; never scrolls the area; Reduce Motion respected; every pointer. No handle = snap.

## Do
- One handle per area, shared by its size-changing components.
- Pass the ScrollableArea ref as containerRef; it does not register itself.

## Do not
- Wrap following content in an extra element to make it move.
- Animate height yourself alongside it.

## See also
- TreeList
- Collapsible
- ScrollableArea
