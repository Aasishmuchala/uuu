# FieldStatus
Group: Field. Category: Form Controls.
Import: import { FieldStatus } from '@astryxdesign/core';

Validation feedback message for fields/custom controls. Supports error, warning, success and attached/detached variants. Announced via persistent live regions (assertive for errors, polite otherwise).

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| type | 'error' \| 'warning' \| 'success' |  | yes | error/warning/success status tone |
| message | string |  | yes | visible validation feedback text |
| id | string |  |  | id for aria-describedby association |
| variant | 'attached' \| 'detached' | 'attached' |  | attached overlaps input; detached floats below |

## Do
- Use attached status below bordered inputs when message belongs to that input.
- Use detached status for checkboxes, switches, and custom controls where overlap is visually awkward.
- Status announces when it appears and on message/type change only. On a repeated submit with unchanged errors, the form announces once via useAnnounce (error count + first error) and focuses the first invalid field.

## Do not
- Use FieldStatus for general alerts or page-level notices; use Banner or Toast instead.
