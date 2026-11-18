# useIndicatorFocusRing
Category: focus.
Import: import { useIndicatorFocusRing } from '@astryxdesign/core';

Draws the standard focus ring on the indicator of a control whose input is visually hidden (checkbox / radio). Painted imperatively on the indicator element (only element whose border-radius shapes the outline), on :focus-visible only.

## Do
- Wrap only the indicator in the ref'd element; a wrapper w/ label text rings the whole row.
- Spread focusProps on the element containing the hidden input, not the input.

## Do not
- Delegate the ring to a themeable indicator; a replacement that ignores it loses visible focus.

## See also
- CheckboxInput
- RadioList
- Selector
- useFocusTrap
