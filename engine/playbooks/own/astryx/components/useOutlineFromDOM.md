# useOutlineFromDOM
Category: Navigation.
Import: import { useOutlineFromDOM } from '@astryxdesign/core';

Outline items from h1-h6 inside a DOM element. Updates when those headings change. Empty when the ref is null.

## Do
- Give each listed heading an id. A heading without one is omitted.
- Point the ref at the article, not the whole page.

## Do not
- Expect the hook to invent heading ids.
- Use it for a Markdown string. useOutlineFromMarkdown matches Markdown.

## See also
- Outline
- useOutlineFromMarkdown
