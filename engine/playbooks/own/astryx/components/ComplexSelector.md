# ComplexSelector
Group: Selector. Category: Form Controls.
Import: import { ComplexSelector } from '@astryxdesign/core';

Input/secondary/ghost trigger + dialog-popover shell for rich custom selectors. Content gets value/onChange/close/state; content owns semantics. Use focus hooks and evaluate custom content against WCAG 2.2.

## Do
- Use variant="ghost" with a startIcon for a toolbar trigger. Use alignment="end" when a wide surface should align its end edge to the trigger.
- For staged editors, keep draft state in the composed content and call the provided onChange helper only from Apply. Cancel or dismiss without committing.
- Compose content from the right accessible structure: RadioList for a simple choice, Calendar/date inputs for dates, TreeList or a searchable list for hierarchy, a custom grid for 2D arrow navigation.
- Use the onChange helper from children; it calls both onChange and changeAction and updates optimistic busy state.
- Call close() from custom content when a selection should dismiss the popup. Keep it open for multi-step or freeform flows.
- Use Astryx focus hooks: useGridFocus for 2D grids, useTreeFocus via TreeList for hierarchies, useListFocus for custom linear collections.
- Evaluate custom content against WCAG 2.2: keyboard operation, focus visible/not obscured, names and roles, labels/instructions, target size, and contrast.

## Do not
- Do not rebuild trigger ARIA, popover focus management, or changeAction handling in product code.
- Do not use ComplexSelector for a plain single-column text list; use Selector instead.
- Wrap a disabled ComplexSelector in Tooltip to explain why it is disabled; the text would not describe the trigger. Use the disabledMessage prop instead.

## Parts
- ComplexSelector
