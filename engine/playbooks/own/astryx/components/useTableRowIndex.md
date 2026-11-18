# useTableRowIndex
Import: import { useTableRowIndex } from '@astryxdesign/core';

Returns a TablePlugin with a right-aligned monospaced row-number column, 1-based by default. Without data, Table supplies positions; with data, ordinary numbers follow it. Windowed rows use the parent logical position, and nondefault startFrom falls back to full rendering.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| data | T[] |  |  | Optional array whose order ordinary numbers follow; omit to use Table row positions. |
| getRowKey | (item: T) => string |  |  | Optional key extractor used with data; otherwise items match by reference. |
| label | ReactNode | '#' |  | Header label for the index column. Default '#'. |
| startFrom | number | 1 |  | First index value. Default 1. |
