# useTableSelectionState
Import: import { useTableSelectionState } from '@astryxdesign/core';

State companion for useTableSelection. Returns selectionConfig for the behavior plugin + selectionState for selection-aware UI. Handles disabled/selectable row filtering for select-all automatically: disabled rows frozen (state preserved across select-all/deselect-all), non-selectable rows excluded.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| data | T[] |  | yes | full data array rendered in table |
| idKey | (keyof T & string) \| ((item: T) => string) |  | yes | key extractor: property name or fn returning unique string ID |
| selectedKeys | Set<string> |  | yes | controlled set of selected item IDs |
| setSelectedKeys | Dispatch<SetStateAction<Set<string>>> |  | yes | setter for controlled selected keys |
| getIsItemSelectable | (item: T) => boolean | () => true |  | Returns whether row shows checkbox; non-selectable rows excluded from select-all. Defaults to () => true. |
| getIsItemEnabled | (item: T) => boolean | () => true |  | Returns whether row checkbox is interactive; disabled rows frozen: select-all preserves their state. Defaults to () => true. |
