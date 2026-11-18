# Overlay
Group: Overlay. Category: Overlay.
Import: import { Overlay } from '@astryxdesign/core';

layered content over media/card surfaces with scrim + hover/focus/controlled reveal

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| content | ReactNode |  | yes | overlay content inside scrim; required |
| children | ReactNode |  |  | base media/card/surface beneath overlay |
| showOn | 'hover' \| 'always' \| 'focus' \| 'hover-or-focus' | 'always' |  | visibility trigger; hover also focus-visible; default always |
| isOpen | boolean |  |  | controlled visibility override |
| scrim | 'dark' \| 'light' \| false | 'dark' |  | dark/light scrim or false for no scrim; default dark |
| position | 'fill' \| 'bottom' \| 'top' | 'fill' |  | scrim placement: fill, bottom strip, or top strip |
| align | 'start' \| 'center' \| 'end' | 'end' |  | content alignment inside scrim |
| xstyle | StyleXStyles |  |  | StyleX layout styles; must be stylex.create() value |
| className | string |  |  | additional root class names |
| style | React.CSSProperties |  |  | inline root styles; prefer xstyle |
| ref | Ref<HTMLDivElement> |  |  | forwarded root div ref |

## Do
- Use for short contextual actions/labels tied to the underlying surface.
- Keep content compact and legible over the scrim.

## Do not
- Do not use for floating anchored surfaces; use Popover, Tooltip, or Dialog.
