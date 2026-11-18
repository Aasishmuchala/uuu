# InputGroupText
Import: import { InputGroupText } from '@astryxdesign/core';

prefix/suffix text/icon element

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | text or icon content |
| xstyle | StyleXStyles |  |  | StyleX styles (stylex.create() value) |
| className | string |  |  | CSS class name(s) |
| style | React.CSSProperties |  |  | inline styles |
| ref | React.Ref<HTMLDivElement> |  |  | ref to the text cell |

## Do
- Keep the text short, such as $, [address left out] or kg. It stays on one line and does not shrink.
- Plain text keeps its character order under right-to-left, so [address left out] and .com read as written. When rich content mixes directions, mark the direction on your own content, for example with `dir` or `<bdi>`.
- Put what a screen reader user needs in the input's own label, such as "Amount in USD" beside a $ prefix. The addon is read as plain text in reading order.

## Do not
- Put buttons, links, or other controls inside InputGroupText. Use a Button addon for an action.
- Use InputGroupText outside InputGroup. Its borders and corners join an InputGroup row.
