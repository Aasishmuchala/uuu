# SelectableCard
Group: Card. Category: Container.
Import: import { SelectableCard } from '@astryxdesign/core';

Card toggling between selected/unselected states w/ accent border. For navigation use ClickableCard instead.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | accessibility label |
| isSelected | boolean |  | yes | controlled selection state |
| onChange | (isSelected: boolean) => void |  | yes | called when toggled |
| isDisabled | boolean | false |  | disables card |
| children | ReactNode |  |  | Card content. |
| padding | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 | 4 |  | inner padding |
| variant | 'default' \| 'transparent' \| 'muted' \| 'blue' \| 'cyan' \| 'gray' \| 'green' \| 'orange' \| 'pink' \| 'purple' \| 'red' \| 'teal' \| 'yellow' | 'default' |  | background color variant |
| elevation | 'none' \| 'low' \| 'med' \| 'high' | 'none' |  | resting shadow depth: none\|low\|med\|high; selection ring composes on top |
| width | SizeValue |  |  | card width |
| height | SizeValue |  |  | card height |
| maxWidth | SizeValue |  |  | max card width |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value, not an inline style object like style={{}}. |

## Do
- Use for multi-select choices: filter chips, add-ons, option grids.
- Use for multi-select groups; track selected IDs in a Set.
- When focused, toggle selection with Space or Enter.

## Do not
- Use for navigation; use ClickableCard instead.
- Use for single-select: each card is a checkbox, so screen readers announce multi-select.
