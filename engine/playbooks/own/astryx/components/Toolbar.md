# Toolbar
Category: Action.
Import: import { Toolbar } from '@astryxdesign/core';

Horizontal bar w/ left, center, right areas. For contextual actions in content, not page headers. Size cascades to children.

## Do
- Secondary actions (Back) left, primary actions (Save) right.
- Make temporary toolbars (bulk selection) visually distinct, e.g. background color or border.
- Separate toolbar from content: divider, background variant, or both.
- Use Toolbar as card header when it has actions (filter, add). Just a title? Use LayoutHeader/Section.

## Do not
- Overload with actions; use MoreMenu for overflow.
- Set size on child buttons; set once on toolbar, it cascades.
- Use for app-wide nav (menu links, sign out); use TopNav/LayoutHeader.

## Parts
- Toolbar
