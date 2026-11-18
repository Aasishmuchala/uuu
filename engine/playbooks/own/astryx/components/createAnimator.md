# createAnimator
Group: Utilities. Category: motion & gestures.
Import: import { createAnimator } from '@astryxdesign/core';

Animates one element (x, y, scale, rotate, opacity) with Astryx's motion, without React.

## Do
- Start every `animate` that follows a drag with the release velocity, so the element carries on as it was thrown.
- Reach every state an animation shows without the animation too: a key, a button or a menu item that calls the same code.
- `await` the promise before removing an element you animate out, and call `destroy` once it is gone.

## Do not
- Read the element’s position from layout while it moves: `get` gives the value on screen, wherever the motion runs.

## See also
- useAnimator
- useAnimatedLayout
