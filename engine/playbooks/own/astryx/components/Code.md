# Code
Group: Code. Category: Content.
Import: import { Code } from '@astryxdesign/core';

inline semantic code for short technical references in prose; CodeBlock handles standalone or multi-line snippets

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | inline code content. |
| color | 'primary' \| 'secondary' \| 'inherit' | 'primary' |  | text color: primary, secondary, or inherited from surrounding text. |
| size | 'inherit' |  |  | set to 'inherit' to take the surrounding font size and line height. |
| ref | React.Ref<HTMLElement> |  |  | ref forwarded to the semantic code element. |
| xstyle | StyleXStyles |  |  | StyleX layout styles; must be a stylex.create() value, not an inline style object. |
| className | string |  |  | CSS class for the root; prefer xstyle. |
| style | CSSProperties |  |  | inline styles for the root; prefer xstyle. |
| data-testid | string |  |  | test selector for automated testing frameworks. |

## Do
- Use for short technical references inside prose.
- Set size='inherit' to match surrounding text size and line height.

## Do not
- Use for multi-line or standalone snippets; use CodeBlock instead.
- Use as an interactive control; pair with Button or Link for actions.
