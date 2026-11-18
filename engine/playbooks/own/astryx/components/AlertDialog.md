# AlertDialog
Group: Dialog. Category: Overlay.
Import: import { AlertDialog } from '@astryxdesign/core';

Confirms destructive/irreversible action before it happens (delete, revoke access, discard unsaved changes).

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| isOpen | boolean |  | yes | Whether the dialog is open. |
| onOpenChange | (isOpen: boolean) => unknown |  | yes | Visibility change callback. |
| title | string |  | yes | Dialog title. Linked via aria-labelledby. |
| description | string |  | yes | Consequence description. Linked via aria-describedby. |
| actionLabel | string |  | yes | Action button label. |
| onAction | () => unknown |  | yes | Called when action button is clicked. Does NOT auto-close. |
| cancelLabel | string | 'Cancel' |  | Cancel button label. |
| actionVariant | ButtonVariant | 'destructive' |  | Action button variant. |
| isActionLoading | boolean |  |  | Shows loading spinner on the action button. |
| width | number \| string | 400 |  | Requested dialog width. Dialog preserves this preferred width and clamps it to the container and dynamic viewport with token gutters. |
| isInline | boolean | false |  | Renders alert dialog content inline without modal behavior. For documentation previews and showcases only. Not being a modal, the inline path renders role="group" instead of role="alertdialog". |

## Do
- Make action button label specific: "Delete project" > "OK"/"Confirm".
- Describe consequences in description so user knows outcome before confirming.
- Keep cancel as initial focus: least destructive choice is preselected even when narrow visual/DOM order places it after the destructive action.
- Use concise action labels; >640px complete buttons may move to another row, and <=640px puts the destructive action above Cancel with both buttons full width regardless of pointer type.

## Do not
- Use AlertDialog for non-destructive actions; use standard Dialog instead.
- Rely on color alone for danger; the action label should say what happens.
- Close from onAction before work finishes; hold open w/ isActionLoading, call onOpenChange(false) when it settles.

## Parts
- useImperativeAlertDialog
