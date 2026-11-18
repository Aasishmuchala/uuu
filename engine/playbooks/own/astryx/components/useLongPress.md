# useLongPress
Category: interaction.
Import: import { useLongPress } from '@astryxdesign/core';

Single-finger press-and-hold detection reporting the touch point. iOS Safari never fires contextmenu on long-press, so this is the only touch route to cursor-positioned surfaces. Cancels on move / lift / multi-touch / unmount.

## Do
- Position the opened surface at the reported point.
- Pair w/ pointer contextmenu handler; this covers touch only.

## Do not
- Make press-and-hold the only way to reach an action; it is undiscoverable.

## See also
- ContextMenu
- useClickableContainer
- useHotkeys
