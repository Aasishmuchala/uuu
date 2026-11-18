# MobileNav
Group: Navigation. Category: Navigation.
Import: import { MobileNav } from '@astryxdesign/core';

Slide-out drawer overlay for mobile navigation. Mobile counterpart to SideNav; accepts same children (SideNavSection, SideNavItem, or any ReactNode).

## Do
- Share nav items between MobileNav and SideNav by extracting into a variable.
- Provide a header when the drawer purpose is not obvious from content.
- Inside AppShell, use MobileNavToggle to open the drawer; it reads state from context. Do not pass isOpen/onOpenChange to the toggle.

## Do not
- Use MobileNav on desktop; use a persistent SideNav instead.

## Parts
- MobileNav
- MobileNavToggle
