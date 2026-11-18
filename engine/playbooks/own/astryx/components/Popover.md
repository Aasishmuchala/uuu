# Popover
Group: Popover. Category: Overlay.
Import: import { Popover } from '@astryxdesign/core';

Click-triggered popover displaying interactive content anchored to trigger element; implements button+dialog ARIA pattern.

## Do
- Keep popover content focused on a single task or piece of information.
- Provide a clear way to close: either by clicking outside or with an explicit close button.
- Theme the painted surface through the canonical popover target.

## Do not
- Nest popovers inside other popovers; it creates confusing focus and navigation.
- Assume input complexity alone determines the presentation; evaluate the task's focus, space, and interaction requirements.
- Assume scrolling alone means Popover is the wrong component; a bounded Popover may scroll while a focused anchored interaction remains appropriate.

## Parts
- Popover

## Example
```jsx
<Popover
  label="Recent files"
  padding={0}
  content={
    <List>
      <ListItem label="Quarterly report.pdf" />
      <ListItem label="Roadmap.key" />
    </List>
  }>
  <Button label="Recent" variant="secondary" />
</Popover>
```
