# useTableStickyColumns
Import: import { useTableStickyColumns } from '@astryxdesign/core';

Hook returning TablePlugin that pins contiguous column runs to start/end edges w/ cumulative offsets + scroll-aware shadow. Empty config = no-op.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| startKeys | string[] |  |  | Column keys pinned to the start edge (contiguous run from column 0 through the last listed key). |
| endKeys | string[] |  |  | Column keys pinned to the end edge (contiguous run from the first listed key through the last column). |
