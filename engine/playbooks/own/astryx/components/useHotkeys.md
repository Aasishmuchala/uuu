# useHotkeys
Category: interaction.
Import: import { useHotkeys } from '@astryxdesign/core';

Global keyboard shortcuts w/ one window keydown listener per hook instance. Handlers kept in ref; re-renders never re-subscribe. Skips typing targets (input/textarea/select/contenteditable) unless allowInInputs, skips defaultPrevented and IME key events (even with allowInInputs), preventDefault() on match. "mod" = ⌘ on macOS, Ctrl elsewhere. SSR-safe.

## Do
- Use for app-level shortcuts: command palettes (mod+k), help overlays (shift+/), navigation keys.
- Pair w/ Kbd component to display same combo registered; both resolve "mod" per platform identically.
- Use isDisabled to suspend shortcuts while modal/wizard owns keyboard, instead of unmounting hook.

## Do not
- Use for focus-scoped keyboard nav inside widget; use useListFocus / useGridFocus instead.

## See also
- Kbd
- useListFocus
- useGridFocus
