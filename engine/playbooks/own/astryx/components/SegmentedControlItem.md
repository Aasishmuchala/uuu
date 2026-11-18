# SegmentedControlItem
Import: import { SegmentedControlItem } from '@astryxdesign/core';

individual segment; renders as radio button in control

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| value | string |  | yes | unique segment value; matched against parent |
| label | string |  | yes | segment label; visible unless isLabelHidden |
| isLabelHidden | boolean | false |  | hides label visually; label becomes aria-label |
| icon | ReactNode |  |  | icon before label |
| isDisabled | boolean | false |  | disables this item |
