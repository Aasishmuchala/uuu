# createDragToSnapPoints
Group: Utilities. Category: interaction.
Import: import { createDragToSnapPoints } from '@astryxdesign/core';

A drag that settles an element on snap points (px offsets) at the release, without React.

## Do
- Offer the same positions without a drag: buttons or keys that call `settleTo`.
- Keep the snap points few and far apart, so a release clearly picks one.

## Do not
- Use it for a sheet or a carousel: their own props already settle the way people expect.

## See also
- BottomSheet
- Carousel
- useDragToSnapPoints
- createPanGesture
- createAnimator
