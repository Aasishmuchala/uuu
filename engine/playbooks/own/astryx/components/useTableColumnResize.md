# useTableColumnResize
Import: import { useTableColumnResize } from '@astryxdesign/core';

Hook returning TablePlugin w/ draggable column resize handles. Pointer + keyboard (WAI-ARIA splitter), RTL, per-column min/max, proportional-preserving (resizes neighbor). Commits on release.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| columnWidths | Record<string, number> |  |  | Controlled pixel-width overrides keyed by column key. |
| onColumnResizeEnd | (updates: Record<string, number>) => void |  |  | Called on resize end; receives map of all changed column widths to merge into state. |
| minWidth | number |  |  | Global min column width (px) during resize. |
| maxWidth | number | Infinity |  | Global max column width (px) during resize. Default Infinity. |
| columns | TableColumn<T>[] |  |  | Column defs: derive per-column mins + proportional/pixel detection for neighbor/last-column behavior. |
