# useInputContainer
Category: interaction.
Import: import { useInputContainer } from '@astryxdesign/core';

Makes input container wrapper clickable, delegating focus to inner input/textarea when user clicks non-interactive areas (icons, padding, status indicators). Built on useClickableContainer, so nested interactive elements (clear buttons, calendar toggles, links) handled safely; clicking them does NOT steal focus from input. Automatically detects input type: text-like inputs receive .focus(), other types (checkbox, radio, file) receive .click().

## Do
- Use inside input wrapper components (TextInput, NumberInput, TimeInput, TextArea) to make full container area clickable.
- Attach both onClick + onMouseUp to wrapper div for full interaction handling.

## Do not
- Use on bare inputs w/o wrapper; no benefit if input already fills full clickable area.

## See also
- TextInput
- NumberInput
- TimeInput
- TextArea
- useClickableContainer
