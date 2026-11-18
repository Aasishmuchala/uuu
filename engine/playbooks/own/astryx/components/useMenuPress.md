# useMenuPress
Category: interaction.
Import: import { useMenuPress } from '@astryxdesign/core';

macOS/iOS menu press model for any pointer: the row under the RELEASE acts, the highlight follows a held pointer, a mouse opens on press and drags in, a finger or a pen opens while down (on press with no delay given, else after its hold). Document-level pointerId tracking; the browser stray click after a touch is swallowed. Already mounted by DropdownMenu / ContextMenu / DropdownMenuSubMenu / Selector / menu bottom sheet.

## Do
- itemSelector = ENABLED rows only.
- Default focus highlight in menus; onHighlight only for aria-activedescendant listboxes.
- touch-action on the root: pinch-zoom when rows fit, pan-y pinch-zoom when it scrolls.

## Do not
- Also act on pointerdown / pointerup in the row; the hook already acts on release.
- Treat a detail-0 row click as keyboard; the hook dispatches w/ detail 0 too — use isMenuPressActivation().

## See also
- DropdownMenu
- ContextMenu
- Selector
- useListFocus
- useTypeahead
- useLongPress
