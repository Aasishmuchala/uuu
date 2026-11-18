# useTablePagination
Import: import { useTablePagination } from '@astryxdesign/core';

Headless pagination plugin. Client-side slicing, server-side, or cursor-based. Auto-renders Pagination above/below/both.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| page | number |  | yes | Current page (1-based). |
| onPageChange | (page: number) => void |  | yes | Called on page change. |
| totalItems | number |  |  | Total items across all pages. |
| totalPages | number |  |  | Total number of pages. Use when you know the page count but not item count. |
| hasMore | boolean |  |  | Whether more pages exist. Use for cursor-based pagination where the total is unknown. |
| pageSize | number | 10 |  | Items per page. Default 10. |
| onPageSizeChange | (pageSize: number) => void |  |  | Called when the user changes the page size. Shows a page size dropdown when provided with pageSizeOptions. |
| pageSizeOptions | number[] |  |  | Available page size options. Shows a page size selector when provided. |
| variant | 'pages' \| 'count' \| 'compact' \| 'dots' \| 'none' | 'pages' |  | Pagination variant: 'pages'\|'count'\|'compact'\|'dots'\|'none'. |
| position | 'below' \| 'above' \| 'both' \| 'none' | 'below' |  | Render position: 'below'\|'above'\|'both'\|'none'. |
| align | 'start' \| 'center' \| 'end' | 'center' |  | Horizontal alignment of the pagination controls. |
| label | string | 'Table pagination' |  | Accessible name for the nav landmark; position='both' emits '<label> (top)' / '<label> (bottom)'. |
