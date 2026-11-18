# Citation
Group: Citation. Category: Content.
Import: import { Citation } from '@astryxdesign/core';

Inline reference to external source. Attribute info in AI responses, articles, or anywhere provenance needed.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| source | CitationSource |  | yes | citation source with title, url, optional image src, and optional icon. url follows the Link href navigation rule; rejected destinations stay visible without navigation. Image src handling is separate. |
| number | number |  | yes | display index for this citation. |
| variant | 'label' \| 'number' | 'label' |  | display style: label chip with source title or compact numbered badge. |

## Do
- Use label variant when source title adds meaningful context.
- Use number variant for compact inline references in body text, like footnotes.

## Do not
- Mix label and number variants in same paragraph. Pick one style per context.
