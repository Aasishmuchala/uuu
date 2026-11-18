# DropdownMenuItem
Import: import { DropdownMenuItem } from '@astryxdesign/core';

one pointer-menu action/destination row; parent owns keyboard, row owns activation, state, destination, content, and root inputs

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| icon | IconType |  |  | icon before label |
| label | ReactNode |  | yes | primary label text |
| description | ReactNode |  |  | secondary text below label |
| onClick | (event: MouseEvent) => void |  |  | selection callback (event); keyboard activation = synthesized click w/ modifiers; skipped for a modified click on an href row |
| href | string |  |  | row is a real anchor w/ role=menuitem; modified/middle click keeps browser meaning |
| target | '_blank' \| '_self' |  |  | link target ('_blank' \| '_self'), with href |
| rel | string |  |  | link rel; noopener noreferrer added for _blank |
| isDisabled | boolean | false |  | unavailable; removes destinations and suppresses activation |
| endContent | ReactNode |  |  | non-interactive content after label+description |
| hasCloseOnSelect | boolean | true |  | false keeps the menu open on activation (in-place result on the item) |
| variant | 'default' \| 'destructive' | 'default' |  | 'destructive' renders the item in the error color for dangerous actions |
| xstyle | StyleXStyles |  |  | StyleX styles for root container |
| ref | React.Ref<HTMLElement> |  |  | forwarded to the row root (the role="menuitem" element) |

## Do
- Use href for a destination so LinkProvider, modified clicks, middle clicks, and browser link affordances remain available.
- Use hasCloseOnSelect=false only when activation reports a result in place on the same row.

## Do not
- Put buttons, links, or other focusable controls inside label, description, or endContent. Each menu row is one interactive target.
