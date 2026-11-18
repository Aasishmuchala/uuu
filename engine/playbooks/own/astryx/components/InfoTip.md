# InfoTip
Category: Feedback & Status.
Import: import { InfoTip } from '@astryxdesign/core';

Inline info-icon help affordance: accessible "i" button trigger pre-wired into a Tooltip.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| content | ReactNode |  | yes | Tooltip content. Short, non-interactive text. Mirrors Tooltip content prop. |
| label | string | 'More information' |  | Accessible name for the trigger button. Default: the translated 'More information'. |
| size | 'xsm' \| 'sm' \| 'md' \| 'lg' | 'sm' |  | Info icon size (12/16/20/24px). Maps 1:1 to Icon sizes. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value, not an inline style object like style={{}}. |

## Do
- Keep tooltip content concise, plain, and non-interactive; use Popover or HoverCard for links and buttons.
- Override label when "More information" is too generic, e.g. "About this metric".
- Rely on InfoTip rather than a hand-rolled info button on touch: it pins its help on a press, so a tap, a click, Enter, or Space pins the tooltip even though the trigger is a button, and a tap outside dismisses it.

## Do not
- Hand-compose Icon inside Tooltip for info affordances; the bare Icon is aria-hidden and unfocusable.
- Use InfoTip for essential information users must see to complete a task; put that text inline instead.
