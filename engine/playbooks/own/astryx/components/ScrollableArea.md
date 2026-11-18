# ScrollableArea
Category: Layout.
Import: import { ScrollableArea } from '@astryxdesign/core';

native logical-axis scroll viewport with conditional keyboard access, live edge state, and observed content geometry

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| axis | 'inline' \| 'block' \| 'both' | 'block' |  | logical scroll intent: 'inline' \| 'block' (default) \| 'both' |
| label | string |  | yes | required accessible viewport name |
| role | 'group' \| 'region' | 'group' |  | named viewport semantics: 'group' (default) \| 'region' (landmark-navigation entries only) |
| overscroll | 'allow' \| 'contain' | 'allow' |  | edge behavior: 'allow' (default) \| 'contain' on effective axes only |
| width | SizeValue |  |  | viewport width |
| height | SizeValue |  |  | viewport height |
| maxWidth | SizeValue |  |  | viewport maximum width |
| minHeight | SizeValue |  |  | viewport minimum height |
| stickyContainment | 'whenScrollable' \| 'always' | 'whenScrollable' |  | fitting Sticky ownership: 'whenScrollable' (default) \| 'always' |
| padding | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 | 0 |  | content inset on every edge; defaults to 0 and publishes geometry |
| paddingInline | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical inline-axis content inset |
| paddingInlineStart | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical inline-start content inset |
| paddingInlineEnd | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical inline-end content inset |
| paddingBlock | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical block-axis content inset |
| paddingBlockStart | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical block-start content inset |
| paddingBlockEnd | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical block-end content inset |
| isFullBleed | boolean | false |  | opt-in viewport escape from inherited container padding |
| children | ReactNode |  |  | content inside the observed box |
| xstyle | StyleXStyles |  |  | viewport sizing and native scrollbar presentation overrides |

## Do
- Give every area a concise label that identifies the content keyboard users will scroll.
- Leave `role` unset (it renders `group`) for ordinary scroll containers. Choose `role="region"` only when the area is significant enough to appear in screen-reader landmark navigation; every `region` adds an entry to that list.
- Choose `inline`, `block`, or `both` from content intent; the component maps the logical axes through writing mode and direction.
- Keep the default `overscroll="allow"` for nested areas unless the interaction deliberately needs containment.
- Use `useScrollableArea` instead when a component already owns both a viewport and a suitable content box, or when children must remain direct flex/grid items or retain a definite percentage block-size basis.
- ScrollableArea owns one normal block content box with a 100% minimum size. Inline and both-axis modes use max-content inline sizing, so intrinsic inline layout is intentionally wider than the viewport.
- Use logical padding props on the content box so nested full-bleed components receive the same inset geometry.
- Set `isFullBleed` only when the viewport itself should reach an ancestor container edge; it is off by default.
- Set `stickyContainment="always"` only when a fitting viewport should intentionally remain a Sticky boundary.

## Do not
- Hide the native scrollbar without another visible and operable overflow affordance.
- Add another overflow wrapper around ScrollableArea; one native viewport should own scrolling.
