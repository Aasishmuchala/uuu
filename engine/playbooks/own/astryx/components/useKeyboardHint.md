# useKeyboardHint
Category: focus.
Import: import { useKeyboardHint } from '@astryxdesign/core';

Ephemeral "← → to navigate" hint anchored to the focused item on first keyboard focus of a roving-tabindex composite (Toolbar/TabList/SegmentedControl). Teaches sighted keyboard users that arrows move within the group. Kbd-rendered arrows in a top-layer popover="manual", CSS-anchor-positioned (never clipped by overflow), aria-hidden. Stays until first arrow press, Escape, or blur; never re-shows for that instance.

## Do
- Compose returned onFocus/onKeyDown with existing handlers (call onKeyDown first; it only dismisses).
- Render hintElement as last child; top-layer + aria-hidden, no layout/a11y impact.
- Match orientation to the arrows the widget responds to.

## Do not
- Use for single controls / non-roving widgets.

## See also
- Toolbar
- TabList
- SegmentedControl
- useListFocus
- useGridFocus
- useTreeFocus
