# ChatComposerDrawer
Import: import { ChatComposerDrawer } from '@astryxdesign/core';

collapsible drawer above chat input; pass to composer `drawer` slot for attachments, context chips, previews. `count` enables collapse toggle

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | drawer content: tokens, chips, previews, any React elements |
| count | number |  |  | total count for collapsed summary; enables collapse/expand toggle |
| label | string | 'Items' |  | collapsed label next to the default count badge; names the disclosure action |
| collapsedSummary | ReactNode |  |  | custom visual content replacing the complete Collapsed summary anatomy; requires count; presentation-only; default keeps Badge + label |
| isCollapsed | boolean |  |  | controlled collapsed state |
| defaultIsCollapsed | boolean | false |  | initial collapsed state (uncontrolled) |
| onCollapsedChange | (isCollapsed: boolean) => void |  |  | callback on collapse toggle |

## Do
- Give label a concrete plural noun such as "Attachments" so the expand and collapse actions have a useful accessible name.
- Use controlled isCollapsed with onCollapsedChange when another part of the page owns drawer state; otherwise use defaultIsCollapsed.

## Do not
- Put primary composer actions in the drawer; use ChatComposer footer or send-action slots so those controls remain available when the drawer is collapsed.
