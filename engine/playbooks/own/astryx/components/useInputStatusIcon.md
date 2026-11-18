# useInputStatusIcon
Category: interaction.
Import: import { useInputStatusIcon } from '@astryxdesign/core';

On-field status affordance + a11y wiring for bordered inputs. attached = plain glyph (message box carries text); detached = nothing (box has own icon); tooltip = focusable info-tip button reachable by keyboard / pointer / touch / AT.

## Do
- Render statusIcon in the input container; merge describedBy into aria-describedby.
- Pass isInGroup + variant through; let the hook decide when nothing renders.

## Do not
- Rely on the icon alone for meaning; only the tooltip variant carries the message.

## See also
- TextInput
- TextArea
- NumberInput
- DateInput
- FileInput
- FieldStatus
- InputGroup
- useInputContainer
