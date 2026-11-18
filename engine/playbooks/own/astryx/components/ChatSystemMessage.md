# ChatSystemMessage
Import: import { ChatSystemMessage } from '@astryxdesign/core';

centered non-sender msg; divider variant for date breaks, default for status notices; accepts optional icon content

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | factual React content: date, join/leave, status change; long default content wraps |
| variant | 'default' \| 'divider' | 'default' |  | default=centered text, divider=horizontal lines via Divider for date/section breaks |
| icon | ReactNode |  |  | optional caller icon; rendered before default message; divider currently does not render it |
| xstyle | StyleXStyles |  |  | additional StyleX layout styles |

## Do
- Keep visible content concise and self-contained.
- Use divider for temporal/section boundaries and default for factual notices.

## Do not
- Use for sender-authored content; use ChatMessage and ChatMessageBubble.
- Rely on icon artwork as the only source of meaning.
