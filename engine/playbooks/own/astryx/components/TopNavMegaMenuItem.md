# TopNavMegaMenuItem
Import: import { TopNavMegaMenuItem } from '@astryxdesign/core';

Individual mega menu item. Renders in desktop popover grid + mobile drawer modes via context.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| title | string |  | yes | Display title. |
| description | string |  |  | Description below title. |
| icon | ReactNode |  |  | Left icon element. |
| href | string |  |  | Navigation URL. |
| onClick | () => void |  |  | Click callback. |
| as | LinkComponentType |  |  | Custom link component, overrides LinkProvider default. |
