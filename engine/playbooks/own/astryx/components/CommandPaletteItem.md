# CommandPaletteItem
Import: import { CommandPaletteItem } from '@astryxdesign/core';

one result option; context owns selection, highlight, identity, and close

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| value | string |  | yes | unique value for identity, highlight lookup, and selection |
| children | ReactNode |  | yes | non-interactive label and supporting content |
| onSelect | (value: string) => void |  |  | called after pointer activation; palette keyboard selection uses root onValueChange |
| isHighlighted | boolean | false |  | active keyboard result; derived from context when omitted |
| isSelected | boolean | false |  | selected value in picker mode; derived from palette value when omitted |
| isDisabled | boolean | false |  | unavailable; suppresses pointer activation |
| xstyle | StyleXStyles |  |  | StyleX layout styles; must be stylex.create() value |

## Do
- Keep each value unique within the result list so highlight, active-descendant identity, and selection resolve to the same item.
- Inside CommandPalette, each item is an option in the listbox popup of the WAI-ARIA combobox pattern: keyboard focus stays in the query field, arrow keys move the highlight through aria-activedescendant, and Enter selects the highlighted item.

## Do not
- Nest buttons, links, or other interactive controls inside an item. Option semantics make descendants presentational, so use non-interactive content such as icons, descriptions, and shortcut hints, and activate the option itself.
- Treat isHighlighted as selection. Highlight is the active keyboard result; isSelected represents the chosen value.
