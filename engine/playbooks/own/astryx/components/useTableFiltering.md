# useTableFiltering
Import: import { useTableFiltering } from '@astryxdesign/core';

Table filtering plugin: inline column filters (popover/inline). Pairs w/ useTableFilterState.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| filters | TableFilterState |  | yes | Current filter state map (columnKey → value). |
| onFilterChange | (columnKey: string, value: TableFilterValue \| null) => void |  | yes | Called on filter change. null clears. |
| variant | 'popover' \| 'inline' \| 'inline-compact' | 'popover' |  | Filter control display variant. |
