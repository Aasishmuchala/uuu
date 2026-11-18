# Resizable
Group: Resizable. Category: Layout.
Import: import { Resizable } from '@astryxdesign/core';

Hook-based resizable panel system. useResizable() manages size state; ResizeHandle provides interactive pill-grip separator.

## Do
- Use percent(value, {min: pixel(value)}) or percent(value, {max: pixel(value)}) when a percentage needs exactly one pixel floor or ceiling. Reuse Table’s pixel() helper; numbers, exact Npx, and pixel(value) remain pixels. State, persistence, callbacks, paint, and ARIA remain resolved pixels.
- Use useResizable() with existing Astryx layout components. Pass its output to the resizable prop on LayoutPanel, ResizeHandle or SideNav; any other element can use its size.
- Provide an accessible label on each ResizeHandle when multiple handles exist (e.g. "Resize sidebar", "Resize terminal").

## Do not
- Wrap panels in extra container components for resize. The hook-first architecture avoids extra DOM; use it directly on existing components.

## Parts
- useResizable
- ResizeHandle
