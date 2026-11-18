# Dialog
Group: Dialog. Category: Overlay.
Import: import { Dialog } from '@astryxdesign/core';

modal overlay that blocks page interaction until the user responds

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| isOpen | boolean |  | yes | Whether the dialog is open. |
| onOpenChange | (isOpen: boolean) => unknown |  | yes | Callback when dialog visibility changes. |
| children | ReactNode |  | yes | Dialog content. |
| width | number \| string | 400 |  | Preferred width of the dialog in pixels or any CSS value. Standard dialogs clamp to their container and the dynamic viewport with spacing-token gutters so narrow viewports keep content on screen. |
| maxHeight | number \| string | '75dvh' |  | Maximum height of the dialog. Defaults to a dynamic viewport value so browser UI changes are reflected where supported. |
| position | DialogPosition |  |  | Static position for the dialog; centered by default when omitted. Use logical `start`/`end` for inline offsets so positioned dialogs mirror correctly under RTL. |
| variant | 'standard' \| 'fullscreen' | 'standard' |  | Dialog variant: fullscreen expands to fill the entire viewport. |
| purpose | 'required' \| 'form' \| 'info' | 'info' |  | Controls dismissal behavior: required disables Escape and backdrop click; form disables backdrop click after interaction; info allows both. |
| padding | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | Internal padding of the dialog using the spacing scale step. |
| isInline | boolean | false |  | Renders dialog content inline without the <dialog> element, backdrop, or modal behavior. For documentation previews and showcases only. |

## Do
- Choose the right purpose: info for dismissable content, form to prevent accidental backdrop dismissal, required when user must respond.
- Include a clear title in the header so users immediately understand what the dialog is asking.
- Use purpose="form" for dialogs with inputs so user can't accidentally lose data by clicking the backdrop.
- Keep dialogs focused on a single task; if content grows beyond what fits, consider a full page instead.

## Do not
- Use a dialog for simple messages that could be shown inline or as a toast notification.
- Nest dialogs inside other dialogs; restructure the flow into steps within a single dialog instead.
- Use the fullscreen variant for simple confirmations; it's meant for complex content like editors or long forms.

## Parts
- DialogHeader
- useImperativeDialog
