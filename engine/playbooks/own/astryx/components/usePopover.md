# usePopover
Group: Popover. Category: interaction.
Import: import { usePopover } from '@astryxdesign/core';

Headless click-triggered popovers w/ focus trap, auto-focus, light dismiss, Escape, optional hidden close button. Every surface emits the canonical popover target. Custom compositions needing a distinct seam pass/document an owned surfaceTarget.

## Do
- Use for menus, pickers, forms, command panels needing focus management.
- Prefer Popover for standard trigger-content pairs; use hook for custom trigger patterns.
- Use the canonical popover target for broad surface theming.
- For component-specific reachability, pass and document an owned surfaceTarget; it refines the same surface.

## Do not
- Use for non-interactive hover previews: use useHoverCard / useTooltip instead.

## See also
- Popover
- DropdownMenu
- HoverCard
- useLayer
- useFocusTrap
- useHoverCard
- useTooltip
