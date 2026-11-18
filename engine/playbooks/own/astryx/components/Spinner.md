# Spinner
Category: Feedback & Status.
Import: import { Spinner } from '@astryxdesign/core';

An animated loading indicator for processes with unknown duration, such as data fetching or form submission. Supports visible labels, multiple sizes, and a dark background variant. For content with known dimensions, use Skeleton instead.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| size | 'sm' \| 'md' \| 'lg' \| 'xl' | 'md' |  | Spinner size: ring diameter (10px, 14px, 18px, 28px). |
| shade | 'default' \| 'onMedia' \| 'subtle' \| 'inherit' | 'default' |  | Color shade for light or dark backgrounds. |
| label | ReactNode |  |  | Visible content below spinner. String provides its accessible name unless aria-label is set. |
| aria-label | string | 'Loading' |  | A11y name for screen readers. Defaults to label or a translated "Loading". |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. Must be stylex.create() value, not inline style. |

## Do
- Provide a meaningful label to describe what is loading for screen reader users.
- Use the "onMedia" shade when placed on dark or accent-colored backgrounds.

## Do not
- Use for content areas with known dimensions; use Skeleton to preserve layout instead.
- Stack multiple spinners in the same view; use one to represent the overall loading state.
