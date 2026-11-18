# ChatLayoutScrollButton
Import: import { ChatLayoutScrollButton } from '@astryxdesign/core';

floating scroll-to-bottom btn; fades in when scrolled up, expands w/ label for new msgs. Default in ChatLayout; override via scrollButton prop.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| isVisible | boolean |  | yes | btn visibility: bind to scroll-position check |
| label | string |  |  | optional label; expands btn (e.g. "New messages") |
| onClick | () => void |  | yes | click handler |
