# ToggleButtonGroup
Import: import { ToggleButtonGroup } from '@astryxdesign/core';

groups toggle btns for exclusive/multi-select; discriminated union on type; on touch a press slides across toggles like a menu and only the one lifted on toggles; a mouse press stays native; finger targets grow toward 44 px, up to half the gap to a neighbour

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | ToggleButton children; each member needs a value. Group owns pressed state; member isPressed/onPressedChange/pressedChangeAction are ignored. Selection uses group onChange, with no member Action transition. |
| label | string |  | yes | a11y label (aria-label) |
| type | 'single' \| 'multiple' | 'single' |  | selection mode: single or multiple |
| value | string \| null \| string[] |  | yes | selected value(s); type depends on mode |
| onChange | (value: string \| null \| string[]) => void |  | yes | selection change cb |
| orientation | 'horizontal' \| 'vertical' | 'horizontal' |  | layout direction |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | default btn size; individual btns override |
| isDisabled | boolean | false |  | all btns disabled |
| xstyle | StyleXStyles |  |  | StyleX layout styles; must be stylex.create() value |
| data-testid | string |  |  | test selector |
