# useOutlineFromMarkdown
Category: Navigation.
Import: import { useOutlineFromMarkdown } from '@astryxdesign/core';

Headings of a Markdown string as OutlineItem[] for an Outline beside the rendered document. Same parser and heading slugs as Markdown; memoized on source and options.

## Do
- Pass the same string, plugin list and finality to Markdown and the hook; items match the headings once content is complete.
- Keep the plugin list stable; a new array each render recomputes.
- Several documents on one page: one createMarkdownHeadingLinks per document with headingIdPrefix.

## Do not
- Write items by hand or find headings with a regex.
- Expect every item to have a target while content streams; a heading can be absent or have another id until complete.
- Expect an item to link to a heading that cites a Markdown sources entry; the hook does not receive sources, so the ids differ.
- Expect items for nested headings; only root headings count.

## See also
- Outline
- Markdown
