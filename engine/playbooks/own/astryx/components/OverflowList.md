# OverflowList
Category: Table & List.
Import: import { OverflowList } from '@astryxdesign/core';

horizontal list w/ overflow indicator: hides items beyond container width

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | items to render, each child should be a single element |
| overflowRenderer | (overflowItems: OverflowItem[]) => ReactNode |  |  | renders overflow indicator, receives hidden items w/ index |
| onOverflowChange | (overflowItems: OverflowItem[]) => void |  |  | fires w/ collapsed items when membership/order changes (empty once the row fits again); ignores unrelated renders/callback identity; stable React keys required for dynamic items |
| gap | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 | 2 |  | item gap as spacing step |
| minVisibleItems | number | 0 |  | min items always shown even when overflowing |
| maxVisibleItems | number | undefined (no cap) |  | max items ever shown (cap); extra items collapse to indicator; min wins if smaller |
| maxRows | number | undefined (single line) |  | wrap items across up to N rows then collapse rest (number, not boolean); undefined = single line |
| collapseFrom | 'start' \| 'end' | 'end' |  | which end to collapse from |
| behavior | 'observeSelf' \| 'observeParent' | 'observeSelf' |  | observeSelf (default) or observeParent for content-sized containers |
| xstyle | StyleXStyles |  |  | StyleX styles, use stylex.create() values only |

## Do
- Provide a meaningful overflowRenderer: a "+N more" badge, a dropdown, or a count indicator.
- When the row already has its own menu, use onOverflowChange to feed the collapsed items into it instead of adding a second anchor with overflowRenderer.
- Set minVisibleItems to keep key items visible, and maxVisibleItems to cap the row at a fixed count regardless of available width.
- Use maxRows to let items wrap onto a bounded number of rows (e.g. a two-row tag cloud) before collapsing the rest into the indicator.

## Do not
- Use OverflowList for a vertical stack; horizontal multi-row wrap is supported via maxRows, but items still flow left-to-right, not top-to-bottom.
