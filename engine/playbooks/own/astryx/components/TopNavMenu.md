# TopNavMenu
Import: import { TopNavMenu } from '@astryxdesign/core';

Nav item w/ hover-triggered popover menu containing rich items w/ icon, title, optional description.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | Trigger button visible label. |
| items | TopNavMenuItemData[] |  | yes | Menu items in hover popover. href follows the Link navigation rule; rejected destinations do not navigate. |
| delay | number | 150 |  | Show delay ms on hover. |
| hideDelay | number | 200 |  | Hide delay ms after mouse leaves. |
