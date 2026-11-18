# Token
Category: Content.
Import: import { Token } from '@astryxdesign/core';

compact chip/tag for inline metadata, filters, selections. 11 colors, 3 sizes, removable, clickable, linkable.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | Text label inside token. |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | Token size; 'sm', 'md', or 'lg'. |
| color | 'default' \| 'red' \| 'orange' \| 'yellow' \| 'green' \| 'teal' \| 'cyan' \| 'blue' \| 'purple' \| 'pink' \| 'gray' | 'default' |  | Color variant of token. |
| icon | ReactNode |  |  | Optional icon before label. |
| isDisabled | boolean | false |  | Reduces opacity, blocks interactions. |
| onRemove | (e: React.MouseEvent) => void |  |  | Fired on remove button click. Renders X button when provided. |
| onClick | (e: React.MouseEvent) => void |  |  | Click handler. Renders <span> w/ invisible <button> inside for a11y. |
| href | string |  |  | Link URL. Renders as <a> element. Follows the shared navigation rule (see Link href). |
| description | string |  |  | A11y description via aria-description on root. |
| endContent | ReactNode |  |  | Content after label, before remove button. |
| isLabelHidden | boolean | false |  | Visually hides label w/ screen-reader-only clip; stays accessible. |
| xstyle | StyleXStyles |  |  | StyleX layout styles (margins, positioning). Must be stylex.create() value. |

## Do
- Color-code categories (green for active, red for blocked, blue for review) for fast scanning.
- Provide onRemove when tokens represent dismissible user selections like filters or multi-select values.
- Add a leading icon when it helps identify the token type: person icon for users, tag icon for labels.
- Keep labels to one to three words. Tokens truncate with ellipsis on overflow.
- Labels keep their character order under right-to-left, so `@alice`, `C++` and `example.com` read as written; a right-to-left label still reads right to left.

## Do not
- Don't use tokens for actions or navigation; use Button or Link. Tokens display metadata, not trigger workflows.
- Don't hide the label unless the icon alone is universally clear.
- Don't mix too many colors in one group. Two or three meaningful colors keeps it scannable.
