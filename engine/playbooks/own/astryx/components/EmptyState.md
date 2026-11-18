# EmptyState
Category: Content.
Import: import { EmptyState } from '@astryxdesign/core';

placeholder when a content area has no data: icon, title, description, action buttons

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| title | string |  | yes | Primary msg rendered as heading (h1-h6) inside empty state. |
| description | string |  |  | Optional secondary text w/ additional context below title. |
| icon | ReactNode |  |  | Optional icon/illustration above title; rendered decorative (aria-hidden="true"). |
| actions | ReactNode |  |  | Optional action buttons below description; horizontal by default, vertical when isCompact. |
| headingLevel | 1 \| 2 \| 3 \| 4 \| 5 \| 6 | 3 |  | Controls only HTML heading tag (h1-h6) for document outline; does not change visual title size. |
| isCompact | boolean | false |  | Enables compact variant w/ reduced spacing for constrained areas. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. Must be stylex.create() value. |

## Do
- Include a clear title + call-to-action button so users know how to proceed.
- Use an illustration or icon that reinforces the context of the empty state.
- Use the compact variant inside cards or sidebars where space is limited.

## Do not
- Leave an empty state without guidance; always explain what happened and what user can do next.
- Use a generic message like "No data"; be specific about what is empty and why.
- Use an EmptyState for error messages that require immediate action; use a Banner instead.
