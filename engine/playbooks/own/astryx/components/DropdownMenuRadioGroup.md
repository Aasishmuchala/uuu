# DropdownMenuRadioGroup
Import: import { DropdownMenuRadioGroup } from '@astryxdesign/core';

controlled named menuitemradio group; owns value propagation, close policy, root inputs, and item gap

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| value | string \| undefined |  | yes | selected value (undefined = none) |
| onChange | (value: string) => void |  | yes | fired when selected value changes |
| label | string |  | yes | accessible group name (applied as aria-label); required |
| hasCloseOnSelect | boolean | true |  | close menu on select (default true) |
| ref | React.Ref<HTMLDivElement> |  |  | forwarded to the role="group" root |
| children | ReactNode |  | yes | the DropdownMenuRadioItems |

## Do
- Keep value controlled and update it from onChange so checked state follows caller data.
- Provide a concise label even when aria-labelledby points to visible text; label remains required and supplies the aria-label fallback.
- Set hasCloseOnSelect=false only when the menu must stay open to show another selection or an in-place result.

## Do not
- Place buttons, links, checkboxes, or arbitrary menu rows inside the radio group.
- Add a second key handler or roving-focus model; DropdownMenu owns keyboard navigation.
