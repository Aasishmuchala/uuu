# CommandPaletteList
Import: import { CommandPaletteList } from '@astryxdesign/core';

scrollable results container; role=listbox standalone, and in CommandPalette only while results exist

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | items, groups, empty states |
| label | string | 'Commands' |  | a11y label for listbox |
| xstyle | StyleXStyles |  |  | StyleX layout styles; must be stylex.create() value |
