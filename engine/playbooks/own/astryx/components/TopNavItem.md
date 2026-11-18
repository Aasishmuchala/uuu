# TopNavItem
Import: import { TopNavItem } from '@astryxdesign/core';

Nav link for TopNav startContent; renders as anchor w/ hover+selected states.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | Visible text or aria-label when isIconOnly is true. |
| href | string |  |  | Navigation URL. |
| isSelected | boolean | false |  | Sets aria-current="page"+highlighted styles. |
| isDisabled | boolean | false |  | Sets aria-disabled, drops href/target (no navigation), prevents interaction. |
| isIconOnly | boolean | false |  | Renders the item as a square icon-only element. When true, label becomes the aria-label and visible text is hidden. Requires icon to be set. |
| icon | ReactNode |  |  | Icon before label. |
| children | ReactNode |  |  | Custom content instead of label text. |
| as | LinkComponentType |  |  | Custom link component. Overrides LinkProvider default. Must accept href, className, style, children. |
