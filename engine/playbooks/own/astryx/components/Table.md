# Table
Group: Table. Category: Table & List.
Import: import { Table } from '@astryxdesign/core';

Data-driven table w/ rich cell content via renderCell. Compose cells w/ Badge, StatusDot, Text, Avatar, layout primitives. BaseTable provides unstyled structural core w/ composable plugin pipeline.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| data | T[] |  |  | Array of data items to render as rows. T must extend Record<string, unknown> (use `interface MyRow extends Record<string, unknown>` for custom types). |
| columns | TableColumn<T>[] |  |  | Column definitions: each column has {key, header, width?, align?, renderCell?}. The `header` field sets the column heading text. If omitted, columns are auto-generated from data object keys. The `width` field is typed as `ColumnWidth` (not a number); use `proportional(n)` or `pixel(n)` helpers imported from `@astryxdesign/core/Table`. Omitting `width` keeps an equal flexible share with a compact 60px readability floor. To give one column a different floor, set `width: proportional(1, {minWidth: 80})`; its `minWidth` replaces the 60px floor for that column. Example: `width: pixel(120)` for 120px fixed, `width: proportional(1)` for a flexible column with a 120px default minimum. |
| idKey | (keyof T & string) \| ((item: T) => string \| number) |  |  | Canonical row identity: a property name projects valid strings and finite numbers to strings; a function retains string/number type. Optional legacy tables fall back to index. Virtualization requires explicit unique valid keys. |
| density | 'compact' \| 'balanced' \| 'spacious' | 'balanced' |  | Row density controlling cell padding and font size. |
| dividers | 'rows' \| 'columns' \| 'grid' \| 'none' | 'rows' |  | Divider style rendered between cells. |
| isStriped | boolean | false |  | Applies a background wash to even-numbered rows. |
| hasHover | boolean | false |  | Applies a hover highlight background to rows on pointer devices. |
| verticalAlign | 'middle' \| 'top' \| 'bottom' | 'middle' |  | Vertical alignment for body row cells. Controls `vertical-align` on the `<td>` elements. |
| textOverflow | 'wrap' \| 'truncate' | 'wrap' |  | How body cell text behaves when it exceeds the column width. 'wrap' lets text wrap and the row grow taller; 'truncate' clips with an ellipsis (default-rendered cells show a tooltip on hover when truncated). Header cells always truncate. |
| virtualization | TableVirtualizationCapability \| TableVirtualizationCapability[] |  |  | Geometry-only capability from useTableRowsVirtualization or useTableColumnsVirtualization, or a list with at most one of each; any other list renders without windowing. useTableColumnsVirtualization({initialViewportWidth}) mounts only the unpinned columns near the viewport. useTableRowsVirtualization({rowHeight, initialViewportHeight}) takes sizes that are both positive finite CSS pixels; the Table scrolls inside the height its parent gives it, and initialViewportHeight only sizes the first window. Give the Table's parent a height, fixed or relative, or a flex child, so windowing can bound the rows; with no height every row renders. Pass complete flat data and an explicit idKey. Default text truncates; custom renderers, wrapping, structural plugins, incompatible offsets, invalid identity or unrepresentable geometry use full rendering. Logical row positions include the header. |
| plugins | Record<string, TablePlugin<T>> |  |  | Named plugins that extend table behavior via the transform pipeline. Converted to an ordered array internally. |
| rowIndexStart | number | 1 |  | ARIA row index (1-based) for the first rendered body row. The row ordinal is an accessibility concern independent of any visible index column, so setting this (or rowCount) makes the table emit aria-rowindex on body rows and aria-rowcount on the table. For a paginated/windowed view, pass the offset of the first visible row (e.g. (page - 1) * pageSize + 1) so aria-rowindex reflects position in the full dataset. Data-driven mode only. |
| rowCount | number |  |  | Total number of body rows across all pages/windows, used for aria-rowcount so assistive tech can announce "row X of Y" against the full dataset. When omitted but rowIndexStart is set (windowed view with an unknown total), aria-rowcount is set to -1 per the ARIA unknown-count convention. Data-driven mode only. |
| children | ReactNode |  |  | Children mode: compose the table yourself from TableHeader / TableBody / TableFooter, each holding TableRow and TableCell, instead of using data-driven rendering. The children are passed straight to the <table>, so the section is yours to supply. A TableRow placed directly in Table emits <table><tr>, which is invalid HTML and mismatches on hydration (the parser inserts an implied <tbody> for server-rendered markup; React does not on the client). Data-driven mode renders the sections for you. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value: not an inline style object like style={{}}. |

## Do
- Use density and divider variants to match the information density and scanning needs of your data.
- Compose rich cell content with Astryx components like Badge, StatusDot, and Avatar via renderCell.
- Children mode: wrap rows in TableHeader/TableBody/TableFooter. <table> cannot hold a <tr> directly; the parser adds an implied <tbody> for SSR markup, React does not on the client, so unwrapped rows mismatch on hydration.
- Omitted width = equal flex w/ compact 60px readability floor. Per-column floor: proportional(1, {minWidth}). Weighted: proportional(n). Fixed: pixel(). Table scrolls when combined floors do not fit.
- Data-driven API is RSC-safe: proportional(), pixel(), column defs w/o function props work in Server Components. renderCell (any function prop) requires a "use client" wrapper.

## Do not
- Use a table for data without consistent columns. Use a list or card layout for heterogeneous content.
- Enable every plugin at once. Add only the features your use case requires to keep the interface focused.
- Rely on the 60px omitted-width floor for a text-heavy column that needs more room; set proportional(1, {minWidth}) on it instead.

## Parts
- TableHeader
- TableBody
- TableFooter
- TableRow
- TableCell
- TableHeaderCell
- useTableSelection
- useTableSelectionState
- TableSelectionToolbar
- useTableSortable
- useTableTreeData
- useTableTreeState
- useTablePagination
- useTableColumnSettings
- useTableFiltering
- useTableFilterState
