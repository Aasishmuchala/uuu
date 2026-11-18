# useScrollLock
Category: layout.
Import: import { useScrollLock } from '@astryxdesign/core';

Locks page scroll while active, page stays where it is: overflow: hidden on the root, or on body when its own overflow propagates (wheel, keyboard, scrollbar) + overscroll-behavior-y: none on root and body (no overscroll bounce while locked) + cancels 1-finger pans that would scroll the page (iOS Safari scrolls overflow: hidden pages under a finger); overlay scrollers, range inputs, pinch-zoom + drags on a zoomed page still work. Offset never changes: no jump, iOS toolbar unchanged. Holds the hidden scrollbar's gutter open (scrollbar-gutter: stable) so the page (incl. position: fixed chrome) does not shift sideways.

## Do
- Use when opening full-screen modals / dialogs to prevent background content from scrolling.
- Pass same boolean that controls dialog visibility (e.g. isOpen) as isLocked parameter.

## Do not
- Use for non-modal overlays like popovers / tooltips; users should be able to scroll away from those.

## See also
- Dialog
- useFocusTrap
