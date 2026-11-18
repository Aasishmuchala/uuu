# Kbd
Category: Content.
Import: import { Kbd } from '@astryxdesign/core';

Renders keyboard shortcut as styled key badges. Use in tooltips, menus + help text to show key combinations.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| keys | string |  | yes | Shortcut string. "+" separates keys. Special: mod (⌘ on Apple, Ctrl elsewhere), ctrl, alt, shift (Apple symbols on Apple, text elsewhere), meta (⌘ on Apple platforms, Win elsewhere and before hydration), enter, backspace, escape, tab, up, down, left, right, plus. Aliases: esc for escape, return for enter. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. Must be stylex.create() value. |
| className | string |  |  | CSS class for root element. Prefer xstyle; className for non-StyleX integration. |
| style | CSSProperties |  |  | Inline styles for root element. Prefer xstyle; inline styles bypass StyleX optimization. |
| ref | React.Ref<HTMLSpanElement> |  |  | Ref forwarded to shortcut group element. |
