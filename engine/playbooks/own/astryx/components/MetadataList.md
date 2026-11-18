# MetadataList
Group: MetadataList. Category: Table & List.
Import: import { MetadataList } from '@astryxdesign/core';

label/value metadata display; column layout, collapse, orientation variants

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | Metadata items (MetadataListItem components). |
| columns | 'multi' \| 'single' \| number | 'single' |  | Column layout mode. |
| label | { position?: 'start' \| 'top', width?: number \| string } | { position: 'start' } (vertical single-column) / { position: 'top' } (multi-column or horizontal) |  | Label display configuration. position controls label placement, width sets a custom label column width. Defaults to { position: 'top' } for multi-column layouts. Position is ignored in horizontal mode, which always uses { position: 'top' }. |
| maxNumOfItems | number |  |  | Maximum items to show before collapsing with a show more/less toggle. |
| orientation | 'vertical' \| 'horizontal' | 'vertical' |  | Layout orientation. Horizontal mode flows items in a row with flex-wrap. |
| title | ReactNode |  |  | Optional title or heading above the list. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. Must be a stylex.create() value. |
| className | string |  |  | CSS class name for the root element. Prefer xstyle for styling; className is provided for integration with non-StyleX systems. |
| style | CSSProperties |  |  | Inline styles for the root element. Prefer xstyle for styling; inline styles bypass StyleX optimization. |

## Do
- Choose label position based on content: "start" for short values, "top" for long or complex values.
- Collapse long lists with `maxNumOfItems` to keep the page scannable.
- Give each MetadataListItem a short label that names its value. Assistive technology reads each label with its value as a term and its definition.
- The title does not name the list or add a heading. Pass a heading element as the title when the list needs a place in the page outline.

## Do not
- Use for extensive form input; use a form layout instead.
- Use for data that doesn't have a clear key-value structure.

## Parts
- MetadataListItem
