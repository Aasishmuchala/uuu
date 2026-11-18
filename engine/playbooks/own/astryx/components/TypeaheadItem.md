# TypeaheadItem
Import: import { TypeaheadItem } from '@astryxdesign/core';

Default dropdown item renderer. Label w/ optional icon, description, avatar. Exported for custom renderItem.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| item | SearchableItem |  | yes | Search result item to render. |
| icon | ReactNode |  |  | Icon/avatar before label. |
| description | string |  |  | Text below label. |
| isDisabled | boolean | false |  | Visually disabled. |
| group | string |  |  | No effect. Group results via `item.auxiliaryData.group` in the search source. |
