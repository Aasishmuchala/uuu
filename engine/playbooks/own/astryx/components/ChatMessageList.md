# ChatMessageList
Import: import { ChatMessageList } from '@astryxdesign/core';

presentational msg container w/ density context + infinite scroll; auto-scroll owned by ChatLayout

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | msg elements (ChatMessage or ChatSystemMessage) |
| emptyState | ReactNode |  |  | content when no msgs |
| scrollToTopAction | () => Promise<void> |  |  | async action at scroll top; load older msgs |
| density | 'compact' \| 'balanced' \| 'spacious' | 'balanced' |  | visual density; flows to children via context |
| gap | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | top-level row gap; defaults to density spacing; override for independent LLM/tool rows |
| align | 'top' \| 'bottom' | 'bottom' |  | 'top'\|'bottom' (def bottom); bottom spacer pushes short lists down, top starts at top; overflow scrolls same either way |
| isStreaming | boolean | false |  | assistant streaming? marks log aria-busy so SR announces the completed msg once |
