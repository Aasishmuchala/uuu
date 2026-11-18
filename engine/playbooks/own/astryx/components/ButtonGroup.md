# ButtonGroup
Group: Button. Category: Action.
Import: import { ButtonGroup } from '@astryxdesign/core';

connected button group w/ shared borders, outer-only radius, horizontal/vertical

## Do
- Group buttons that perform related actions on the same object, like copy, cut, paste on selected text.
- Use the same variant for all buttons in a group so they look like a single connected unit.
- Keep groups small (2–4 buttons). For more actions, use a Toolbar or DropdownMenu instead.
- Name the group for what its buttons act on. The label is the group's accessible name and a screen reader reads it before each member.
- Keep the group a single Tab stop. Arrow keys move between members along the orientation, and Home/End jump to the ends. This is the WAI-ARIA APG roving tabindex technique: [address left out]

## Do not
- Don't mix wildly different actions. A Save button next to a Delete button in the same group is confusing.
- Don't use ButtonGroup for navigation. Use SegmentedControl or TabList for switching between views.
- Don't nest ButtonGroups. If you need multiple groups, place them side by side with a gap.
- Don't disable the group to show that an action is in flight. Leave the group enabled and show progress on the button that started the work.

## Parts
- ButtonGroup
