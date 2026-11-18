# Item
Group: Item. Category: Table & List.
Import: import { Item } from '@astryxdesign/core';

universal item primitive w/ startContent+label+description+endContent layout. building block for list items, menu items, contacts, notifications

## Do
- Use named slots (startContent, label, description, endContent) for the common layout. These cover the 80% case.
- Use density="compact" for menus and dense lists, "balanced" for standard rows, and "spacious" for roomier layouts.
- Set labelLines and descriptionLines to control truncation when content length varies.
- Use align="first-line" when a wrapping label sits beside a small mark (a status dot, a radio, a timestamp) that belongs to its first line. Use align="start" to line up the tops of a tall slot and the text.
- Give a swipe action a second home in the row (a menu or a button in endContent): the swipe is a touch accelerator, and a verb reachable only by swipe is unreachable by keyboard and by mouse.

## Do not
- Don't nest interactive elements (buttons, links) inside an interactive Item; it creates confusing focus and click targets.
- Don't use Item for navigation between views; use proper navigation components instead.
- Don't add read/unread or inbox-specific behavior directly; compose a thin wrapper like PreviewItem instead.

## Parts
- Item
