# Stepper
Group: Stepper. Category: Navigation.
Import: import { Stepper } from '@astryxdesign/core';

numbered step sequence for multi-step workflows

## Do
- Keep step labels short and descriptive: "Payment" not "Enter your payment information".
- Use the vertical orientation when steps carry longer descriptions. A horizontal stepper handles narrow containers itself: once the frame gives each step less than horizontalOptions.minimumStepWidth (112px by default) it drops the labels for a segmented track and uses the configured collapsedVariant beneath it.
- Set horizontalOptions.collapsedVariant to 'withLabel' when the page already supplies Back/Continue, or to 'hiddenLabel' when surrounding UI owns both the current-step heading and navigation and only a bare progress track is needed.
- Provide onStepClick for non-linear workflows where users may need to revisit earlier steps.
- Use status only to apply a semantic color (accent/success/warning/error); pass a custom icon for richer indicators.

## Do not
- Use a stepper for fewer than 3 steps; a simple heading or progress bar works better.
- Use more than 7 steps; consider grouping related steps or using a different pattern.

## Parts
- Stepper
- Step
