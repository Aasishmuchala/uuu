# useOverlay
Group: Overlay. Category: interaction.
Import: import { useOverlay } from '@astryxdesign/core';

Overlay behavior on a container you already render (Card, media frame) w/o Overlay's wrapper. Spread containerRef + containerProps on it, render element / renderOverlay(children) once inside. CSS-driven via container :hover/:focus-within; hover mode also reveals on keyboard focus. Hidden content is not focusable, so put a focusable element before it, outside the area a revealed scrim covers (the scrim takes pointer input).

## Do
- showOn 'hover' for media card actions; also reveals on keyboard focus.
- Put a focusable element before the overlay content so Tab reveals it, next Tab reaches it.
- Use Overlay when there is no container to attach to.

## Do not
- Hide the only route to an action behind hover with nothing focusable before it.

## See also
- Overlay
- Card
- AspectRatio
- useClickableContainer
