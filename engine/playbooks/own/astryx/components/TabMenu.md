# TabMenu
Import: import { TabMenu } from '@astryxdesign/core';

Overflow menu trigger; shows selected option's label. Host attributes/DOM handlers reach the trigger button, not the popup/options; role, tab stop and disclosure attributes stay owned.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | Trigger text (when no option selected) + dropdown heading. |
| options | TabMenuOption[] |  | yes | Menu options array rendered in dropdown. |
