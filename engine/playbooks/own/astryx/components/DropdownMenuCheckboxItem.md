# DropdownMenuCheckboxItem
Import: import { DropdownMenuCheckboxItem } from '@astryxdesign/core';

checkable menu item (menuitemcheckbox); independent boolean toggle

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | ReactNode |  |  | primary label text |
| description | ReactNode |  |  | secondary text below label |
| icon | IconType |  |  | icon before label |
| value | boolean |  |  | checked state (controlled, w/ onChange) |
| onChange | (checked: boolean) => void |  |  | fired w/ next checked state on toggle |
| isDisabled | boolean | false |  | disabled (aria-disabled); reached by arrows/typeahead, focusable, inert |
| hasCloseOnSelect | boolean | false |  | close menu on toggle (default false, stays open) |
| ref | React.Ref<HTMLElement> |  |  | forwarded to the row root (the role="menuitemcheckbox" element) |
| endContent | ReactNode |  |  | content after label+description |
