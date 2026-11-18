# useTableGroupedRows
Import: import { useTableGroupedRows } from '@astryxdesign/core';

Groups a flat data array into collapsible section rows. Each groupBy value becomes a full-width header (chevron + label + count); collapsing hides its rows, and aria-expanded stays on the button rather than the native row. Returns {data, plugin, idKey}: pass them to Table data / plugins / idKey. Consumer owns the collapsedGroups set. Under pagination the order is filter, sort, slice, group: sort by the group key first so sections stay contiguous and pages append at the bottom. A row-count cut lands mid-section and the heading counts the page, not the section; where the whole result set is in hand, carry the cut to the end of the section it lands in so every rendered section is complete.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| data | T[] |  | yes | The flat data to group. |
| groupBy | (item: T) => string |  | yes | Derive a row's group key. Same key = same section. |
| collapsedGroups | Set<string> |  | yes | Set of currently-collapsed group keys. |
| onToggleGroup | (groupKey: string) => void |  | yes | Called with the group key when a header is toggled. |
| renderGroupHeader | (groupKey: string, count: number, collapsed: boolean) => ReactNode |  |  | Custom header content (right of chevron). Default '<key> (<count>)'. Args: (key, count, collapsed). |
| getRowKey | (item: T) => string |  |  | Stable key for a real row; positional fallback when omitted. |
| groupOrder | string[] |  |  | Pin these group keys first; others keep first-seen order. |
