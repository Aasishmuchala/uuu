# createPanGesture
Group: Utilities. Category: motion & gestures.
Import: import { createPanGesture } from '@astryxdesign/core';

Reports a drag on an element as values ({state, translation, velocity}), without React; a finger, a mouse and a pen all drive it, though a mouse or pen drag on selectable text selects it instead (give that text user-select: none). Returns {destroy}.

## Do
- Move from translation + the offset at began, so the element moves with the finger from the claim.
- Hand the ended velocity to the settling animation.
- Call destroy when the element leaves the page.

## Do not
- Read layout on every changed event; use translation.

## See also
- usePanGesture
