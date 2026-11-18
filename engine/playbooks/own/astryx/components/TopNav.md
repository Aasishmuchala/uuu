# TopNav
Group: Navigation. Category: Navigation.
Import: import { TopNav } from '@astryxdesign/core';

Top navigation bar for app headers w/ slot-based layout+companion nav item components.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| heading | ReactNode |  |  | Heading slot content (logo, brand): positioned at the left edge of the nav bar. |
| startContent | ReactNode |  |  | Start content slot for navigation items or breadcrumbs: positioned after the heading, left-aligned. |
| children | ReactNode |  |  | Alias for startContent. Prefer startContent when composing with heading, centerContent, or endContent; children keeps the common React nav-item pattern from silently dropping items. |
| centerContent | ReactNode |  |  | Center content slot (tabs, search bar, primary navigation): when provided, switches the layout to three regions that keep it at the middle of the bar while they fit one row; the bar wraps when they do not. |
| endContent | ReactNode |  |  | End content slot for search, icons, or user profile: positioned at the right edge. |
| label | string | 'Top navigation' |  | Accessible label for the navigation landmark, applied as aria-label on the <nav> element. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value: not an inline style object like style={{}}. |

## Do
- Include a product logo and name in the heading slot to clearly identify the application.
- Limit primary navigation items to 5 or fewer for quick scanning and minimal cognitive load.

## Do not
- Avoid using TopNav to filter page content; use Tabs or filter controls instead.
- Avoid deeply nested navigation hierarchies; keep menus to one level of depth.

## Parts
- TopNavHeading
- TopNavItem
- TopNavMenu
- TopNavMegaMenu
- TopNavMegaMenuItem
- TopNavMegaMenuFeaturedCard
