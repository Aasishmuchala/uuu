# GridSpan
Import: import { GridSpan } from '@astryxdesign/core';

Grid item spanning multiple columns/rows.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| columns | number \| 'full' |  |  | Columns to span; 'full' spans all explicit columns. |
| rows | number |  |  | Rows to span. |
| children | ReactNode |  |  | Content. |
| xstyle | StyleXStyles |  |  | StyleX styles on the span wrapper; stylex.create() value only. |
| className | string |  |  | CSS class on the span wrapper. |
| style | React.CSSProperties |  |  | inline styles on the span wrapper; a set columns/rows replaces its grid-column/grid-row. |
| ref | React.Ref<HTMLDivElement> |  |  | ref to the span wrapper div. |
