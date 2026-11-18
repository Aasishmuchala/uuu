# VisuallyHidden
Category: Utility.
Import: import { VisuallyHidden } from '@astryxdesign/core';

renders content in the a11y tree while hiding it visually (sr-only)

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  |  | content exposed to AT while visually hidden |
| as | ElementType | 'span' |  | HTML tag to render as; block element for live regions |

## Do
- Use to give icon-only buttons and controls an accessible name that screen readers announce.
- Render as a block element (as="div") with aria-live to announce dynamic updates like drag-and-drop or result counts.

## Do not
- Use it to hide content from everyone; it stays in the accessibility tree; use conditional rendering or `hidden` to remove content entirely.
- Put interactive controls inside it; the content is not visible and cannot receive pointer input.
