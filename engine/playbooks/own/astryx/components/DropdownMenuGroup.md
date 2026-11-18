# DropdownMenuGroup
Import: import { DropdownMenuGroup } from '@astryxdesign/core';

named role="group" of compound-menu rows; compound peer of the data API's {type: "section"}

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| title | ReactNode |  |  | non-interactive heading above the rows; names the group |
| children | ReactNode |  |  | the grouped menu rows |
| xstyle | StyleXStyles |  |  | StyleX styles on the role="group" wrapper |
| className | string |  |  | CSS class on the role="group" wrapper |
| style | React.CSSProperties |  |  | inline styles on the role="group" wrapper |
| ref | React.Ref<HTMLDivElement> |  |  | ref forwarded to the role="group" wrapper |

## Do
- Short title that explains the rows' relationship.
- Non-interactive title keeps every action in menu arrow navigation.

## Do not
- Controls in title. Put them in DropdownMenu header or footer instead.
- Group unrelated rows.
