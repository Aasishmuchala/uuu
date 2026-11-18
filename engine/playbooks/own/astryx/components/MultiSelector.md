# MultiSelector
Group: Selector. Category: Form Controls.
Import: import { MultiSelector } from '@astryxdesign/core';

checkbox multi-select dropdown for finite sets like column toggles or filter facets

## Do
- Use for a moderate, finite set of options where multiple choices are needed.
- Enable search filtering when the list exceeds ~15 options.
- Use renderOption for custom option rows; the checkbox affordance remains owned by MultiSelector.
- Enable select-all when most users will want all or nearly all options selected.
- Use inside InputGroup only when the control needs a short prefix or suffix addon as part of one decorated input surface; prefer count or labels trigger display so the group stays single-line.
- Use variant="secondary" when a multi-selector sits beside secondary buttons or segmented controls, and variant="ghost" when it sits beside ghost buttons. If validation status is needed there, prefer statusVariant="tooltip" so the toolbar height stays compact.
- Use presentation="adaptive" when the multi-selector should become a bottom sheet on compact touch screens.

## Do not
- Use for single-value selection; use Selector instead.
- Show more than ~20 options without enabling search.
- Wrap a disabled MultiSelector in Tooltip to explain why it is disabled. Use the disabledMessage prop, which attaches the reason to the trigger itself.

## Parts
- MultiSelector
