# DropdownMenuRadioItem
Import: import { DropdownMenuRadioItem } from '@astryxdesign/core';

one option in a DropdownMenuRadioGroup (menuitemradio)

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| value | string |  | yes | item's value within the group (matched vs group value) |
| label | ReactNode |  | yes | primary label text |
| description | ReactNode |  |  | secondary text below label |
| icon | IconType |  |  | icon before label |
| isDisabled | boolean | false |  | disabled (aria-disabled); reached by arrows/typeahead, focusable, inert |
| endContent | ReactNode |  |  | content after label+description |
| ref | React.Ref<HTMLElement> |  |  | forwarded to the row root (the role="menuitemradio" element) |
