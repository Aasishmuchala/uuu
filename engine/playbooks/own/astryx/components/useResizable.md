# useResizable
Group: Resizable. Category: layout.
Import: import { useResizable } from '@astryxdesign/core';

Adds drag-to-resize behavior to layout regions. Supports single-/multi-region configs w/ snap points, collapsible panels, localStorage persistence, cascade resize ordering.

## Do
- Use percent(40, {min: pixel(333)}) for a 40% size with a 333px floor, or percent(10, {max: pixel(400)}) for a 10% size with a 400px ceiling. The options argument is required and carries a floor XOR a ceiling.
- A structured default is an initial choice only; a structured minSize or maxSize remains live. State, persistence, callbacks, resize(), paint, and ARIA all use resolved pixel numbers.
- Import percent and Table’s same pixel binding from @astryxdesign/core/Resizable/utils when constructing configuration in a Server Component; the root package exposes one pixel symbol and one percent symbol without collision.
- Use with Layout or AppShell sidebar for resizable navigation panels.
- Set autoSaveId to persist user-chosen sizes across page reloads.

## Do not
- Set minSize too small; content becomes unreadable. Prefer collapsible for panels that can hide entirely.

## See also
- Resizable
- AppShell
- Layout
- SideNav
- useCollapsible
