# createReorderable
Group: Utilities. Category: interaction.
Import: import { createReorderable } from '@astryxdesign/core';

A collection's reorder behavior, for List's reorderable prop; ListItem itemKey on each row.

## Do
- Give each row a stable key from your data, a string or a number (`itemKey={item.id}`), and apply each move by rendering the items in their new order in the same task.
- Use `isReorderable` for rows that must stay put, such as a pinned first row.
- Offer reorder mode from your own UI too, such as a row's context menu, with `reorderable.start(item.id)`.

## Do not
- Use React's `key` as the reorder key, or index-based keys: a move changes every index after it.

## See also
- List
