# Center
Group: Layout. Category: Layout.
Import: import { Center } from '@astryxdesign/core';

centers content on one or both flex axes; single-axis names match physical axes only in horizontal writing

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| axis | 'both' \| 'horizontal' \| 'vertical' | 'both' |  | centering mode; outside horizontal writing, single-axis values follow flex main/cross axes |
| width | SizeValue |  |  | container width (px or CSS) |
| height | SizeValue |  |  | container height (px or CSS) |
| maxWidth | SizeValue |  |  | Maximum container width (px or CSS value). |
| minHeight | SizeValue |  |  | Minimum container height (px or CSS value). |
| padding | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | inner padding on all sides (spacing step: 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10) |
| paddingInline | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical inline-axis padding; overrides padding on that axis |
| paddingInlineStart | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical inline-start padding; physical edge depends on writing mode and direction |
| paddingInlineEnd | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical inline-end padding; physical edge depends on writing mode and direction |
| paddingBlock | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical block-axis padding; overrides padding on that axis |
| paddingBlockStart | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical block-start padding; physical edge depends on writing mode |
| paddingBlockEnd | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | logical block-end padding; physical edge depends on writing mode |
| isInline | boolean | false |  | use inline-flex for text/icons |
| children | ReactNode |  |  | content to center |
| xstyle | StyleXStyles |  |  | StyleX styles for layout (margins, positioning, sizing); must be stylex.create() value |

## Do
- Use a single-axis value only in horizontal writing, or after verifying the active writing mode. In vertical writing, the current implementation follows flex main/cross axes rather than the physical prop names.
- In horizontal writing, give Center height when using axis="vertical"; centering needs available space on the selected flex axis.
- Use isInline to center small elements (icons, badges) within a line of text without breaking text flow.
- Keep semantic structure and accessible names on the content; Center adds no role or label.

## Do not
- Wrap large page sections in Center. Use Layout or AppShell for page-level structure.
- Use Center for horizontal lists of items. Use Stack with hAlign="center" instead.
