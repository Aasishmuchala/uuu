# useAppShellMobile
Group: AppShell. Category: layout.
Import: import { useAppShellMobile } from '@astryxdesign/core';

Reads/controls AppShell mobile nav context. Use for custom triggers, closing drawer after route changes, or syncing AppShell-adjacent mobile UI to the same breakpoint as mobile nav.

## Do
- Use inside AppShell tree for custom nav controls, route-aware nav items, or UI that should update at AppShell mobile nav breakpoint.
- Prefer MobileNavToggle for standard hamburger; use hook for custom placement, styling, or extra behavior.
- Call closeMobileNav after custom mobile nav item changes route so drawer dismisses.

## Do not
- Use as general responsive primitive when not inside AppShell / not aligning to AppShell mobile nav: use useMediaQuery instead.
- Assume it throws outside AppShell. Hook returns safe defaults + no-op callbacks without provider.

## See also
- AppShell
- MobileNav
- MobileNavToggle
- TopNav
- SideNav
- useMediaQuery
