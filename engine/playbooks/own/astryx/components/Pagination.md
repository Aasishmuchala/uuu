# Pagination
Category: Navigation.
Import: import { Pagination } from '@astryxdesign/core';

Standalone pagination controls for navigating content pages. Supports multiple display variants + works w/ known totals or cursor-based pagination.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| page | number |  | yes | Current page number (1-based). |
| onChange | (page: number) => void |  | yes | Called on page change. |
| changeAction | (page: number) => void \| Promise<void> |  |  | Async action on page change. Fires after onChange; uses React transitions for loading. |
| totalItems | number |  |  | Total items. Calculates page count. Precedence over totalPages. |
| totalPages | number |  |  | Total pages. Use when page count known but not item count. |
| hasMore | boolean |  |  | More pages exist after current. For cursor-based pagination. |
| pageSize | number | 10 |  | Items per page; coerced to positive integer, non-finite falls back to default |
| pageSizeOptions | number[] |  |  | Page size options. Shows selector dropdown when provided. |
| onPageSizeChange | (pageSize: number) => void |  |  | Called on page size change. Auto resets to page 1. |
| variant | 'pages' \| 'count' \| 'compact' \| 'dots' \| 'input' \| 'none' | 'pages' |  | Display between prev/next. 'input' = 'Page [n] / N' + first/last. |
| pageLabel | string |  |  | Noun before the 'input' box (e.g. 'Page' or 'Row'). Navigation stays page-based. Default localized 'Page'. |
| hasFirstLast | boolean | true for 'input'; false for 'compact' |  | Show first/last («/») buttons. 'input' default true; 'compact' default false (opt in). Other variants ignore. Omitted when total unknown. |
| step | number | 1 |  | Pages the prev/next buttons advance per click. Clamped to range; < 1 or non-integer falls back to 1. |
| siblingCount | number | 1 |  | Page buttons each side of current; only variant='pages'. |
| size | 'sm' \| 'md' | 'md' |  | Control size. |
| isDisabled | boolean | false |  | Component disabled. |
| label | string | 'Pagination' |  | Accessible label for nav landmark. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be stylex.create() value. |

## Do
- Place pagination below the content it controls so users see results before navigating.
- Use the pages variant for data tables where users need to jump to a specific page.
- Use the count variant with a page size selector when users need to control how many items they see at once.
- Use the dots variant for carousels and walkthroughs where the total is small and position matters more than a number.
- Pass totalItems when the total is known so users can see how much content remains.

## Do not
- Show pagination when all items fit on a single page; there is nothing to paginate.
- Use the dots variant for more than about 10 pages; the dots become too small to be useful.
- Place pagination above the content; users expect it at the bottom.
