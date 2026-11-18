# Blockquote
Category: Content.
Import: import { Blockquote } from '@astryxdesign/core';

quotation block w/ inline-start rule, secondary text, optional citation

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | blockquote content |
| cite | ReactNode |  |  | optional attribution rendered as <cite> after the quote |
| xstyle | StyleXStyles |  |  | StyleX styles for layout; must be stylex.create() value |

## Do
- Use for quoted text, testimonials, or highlighted excerpts.
- Provide cite when source is known.
- Pass the source via cite, not inside children.

## Do not
- Use for callouts/notes; use Banner instead.
- Wrap the attribution in <footer>; it becomes a contentinfo landmark.
