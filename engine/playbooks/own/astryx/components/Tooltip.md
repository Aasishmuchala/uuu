# Tooltip
Group: Tooltip. Category: Overlay.
Import: import { Tooltip } from '@astryxdesign/core';

Hover/focus triggered tooltip for displaying short, non-interactive text anchored to trigger element.

## Do
- Keep tooltip content concise: aim for under 140 characters of plain text.
- Add a tooltip to icon-only buttons and controls that lack a visible label.
- Set touchTrigger to tap when the trigger is a button whose only job is revealing the tooltip: touch has no hover, and auto keeps the tap for triggers that perform an action. For an info icon, use InfoTip, which also pins its help on a press.

## Do not
- Place interactive elements like links or buttons inside a tooltip; use HoverCard or Popover instead.
- Use tooltips for essential information that users must see to complete a task.

## Parts
- Tooltip
