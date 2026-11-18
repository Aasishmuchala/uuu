# useDragToSnapPoints
Category: interaction.
Import: import { useDragToSnapPoints } from '@astryxdesign/core';

A drag that settles the element at ref on snap points (px offsets): {settleTo}.

## Do
- Offer the same positions without a drag: buttons or keys that call `settleTo`.
- Keep the settled index in state from `onSettle`, and render what the position means from it.

## Do not
- Use it for a sheet or a carousel: their own props already settle the way people expect.

## See also
- BottomSheet
- Carousel
- usePanGesture
- useAnimator
