# useInteractiveRole
Category: interaction.
Import: import { useInteractiveRole } from '@astryxdesign/core';

Resolves what a polymorphic component renders as: href -> link, onClick -> button, interactive trigger context -> its role, else inert. Single place the precedence lives.

## Do
- Switch on returned role; render a real anchor for "link" so platform keyboard / middle-click behavior applies.
- Pass isDisabled through instead of dropping href yourself.

## Do not
- Re-implement href/onClick precedence per component; new trigger contexts are added here.

## See also
- Token
- Thumbnail
- Item
- ClickableCard
- useClickableContainer
