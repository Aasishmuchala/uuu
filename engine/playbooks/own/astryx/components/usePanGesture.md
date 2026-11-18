# usePanGesture
Category: motion & gestures.
Import: import { usePanGesture } from '@astryxdesign/core';

Reports a drag as values ({state, translation, velocity}) for a surface you move yourself; a finger, a mouse and a pen all drive it, though a mouse or pen drag on selectable text selects it instead (give that text user-select: none). Claims at UIKit’s 10 pt; taps, presses and long presses are never a pan, and with axis a scroll across it stays the page’s. Thin layer over createPanGesture(element, options) → {destroy}. No keyboard path of its own: give the drag another way (WCAG 2.5.7). Reduce Motion: honor it in the animation you drive. Prefer BottomSheet snapPoints / Carousel hasSnap when they fit.

## Do
- Move from translation + the offset at began, so the element moves with the finger from the claim.
- Hand the ended velocity to the settling animation.
- Give every drag a keyboard and assistive-technology alternative.
- Use a component's own prop when it covers the job.

## Do not
- Hold the drag offset in a large component’s state.
- Recognize taps or long presses with it.

## See also
- BottomSheet
- Carousel
- useLongPress
- createPanGesture
