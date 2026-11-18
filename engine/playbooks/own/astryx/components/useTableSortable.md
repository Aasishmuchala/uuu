# useTableSortable
Import: import { useTableSortable } from '@astryxdesign/core';

Headless multi-sort plugin. Consumer owns sort state + callback. Shift+click for secondary sort. Sort indicators auto-render in header cells.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| sort | Array<{sortKey: TSortKey, direction: 'ascending' \| 'descending'}> |  | yes | Current sort state; ordered array of {sortKey, direction: 'ascending'\|'descending'} entries. Not 'asc'/'desc'. |
| onSortChange | (sort: Array<{sortKey: TSortKey, direction: 'ascending' \| 'descending'}>) => void |  | yes | Called on header click to change sort. |
| allowUnsortedState | boolean | false |  | Allow cycling to unsorted. true: ascending>descending>unsorted. false: ascending>descending>ascending. |
| isMultiSortEnabled | boolean | false |  | Enable multi-sort via Shift+click. Regular click replaces sort state. |
