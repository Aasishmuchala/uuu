# useAnimator
Category: motion & gestures.
Import: import { useAnimator } from '@astryxdesign/core';

Animates the element behind ref (x, y, scale, rotate, opacity) with Astryx's motion; returns the animator.

## Do
- Call the animator from event handlers and effects: it lives outside render, so animating never re-renders the component.
- Start every `animate` that follows a drag with the release velocity, so the element carries on as it was thrown.
- Reach every state an animation shows without the animation too: a key, a button or a menu item that calls the same code.

## Do not
- Keep the animated values in React state: read them with `animator.get()` when you need them.

## See also
- useAnimatedLayout
