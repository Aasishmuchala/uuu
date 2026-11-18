# FormLayout
Group: Layout. Category: Layout.
Import: import { FormLayout } from '@astryxdesign/core';

Layout container for form fields w/ consistent spacing + direction.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| direction | 'vertical' \| 'horizontal' \| 'horizontal-labels' | 'vertical' |  | Field arrangement. Vertical stacks top-to-bottom; horizontal uses one fractional grid track per field in logical inline order; horizontal-labels places labels on the inline-start side and collapses when the viewport is <=480px. |
| defaultOptionality | 'optional' \| 'required' |  |  | State the form treats as default, so only the exception is marked. "optional" → only isRequired fields show an indicator; "required" → only isOptional fields do. Under "required" unmarked fields also expose aria-required (aria only, not native required), except CheckboxInput, Switch and CheckboxList, which take no required state from it (CheckboxInput and Switch are required only through their own isRequired). Unset = per-field behavior. |
| defaultEntryErrorBehavior | 'complete' \| 'blur-or-enter' |  |  | 'complete'\|'blur-or-enter': when DateInput/DateTimeInput/TimeInput/NumberInput fields show their own rejections (not when validation runs; not React Aria validationBehavior; never changes status). blur-or-enter: message, aria-invalid, styling, announcement, onEntryErrorChange report wait for Enter/blur; valid or empty entry clears at once. NumberInput waits under both. Field prop wins; nested FormLayout replaces it (unset = complete); layers start without it. Unset = complete. |
| children | ReactNode |  |  | Form fields to arrange. Accepts Astryx inputs + Field-wrapped custom controls. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. Must be stylex.create() value. |

## Do
- Stack fields vertically for most forms. It's the easiest to scan top to bottom.
- Nest a horizontal FormLayout inside a vertical one when fields naturally pair up, like First Name + Last Name or City + State + ZIP.
- Use horizontal-labels for settings pages where labels sit beside their inputs.

## Do not
- Use FormLayout for form state or submission. It's just layout. Wrap it in a native <form> for that.
- Put unrelated fields side by side in a horizontal layout. Save it for fields that belong together.
- Nest horizontal-labels inside another FormLayout. It uses CSS Grid and needs to be the outermost container.
