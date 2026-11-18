# ChatMessage
Import: import { ChatMessage } from '@astryxdesign/core';

sender context wrapper; handles avatar+name+metadata+alignment by sender role

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| sender | 'user' \| 'assistant' \| 'system' |  | yes | who sent; controls alignment+layout |
| children | ReactNode |  | yes | free-form: bubbles, assets, tool calls, images; wrap non-bubble content in a ghost bubble to align with bubble text column |
| avatar | ReactNode |  |  | avatar beside msg; null/boolean/"" omit slot; content rendering nothing collapses slot |
| name | ReactNode |  |  | sender name above body; labels msg; null/boolean/"" omit slot, content rendering nothing collapses it; both fall back to translated sender label; use when first child is raw |
| metadata | ReactNode |  |  | metadata below body; null/boolean/"" omit slot; content rendering nothing collapses slot; use when last child is raw |
| density | 'compact' \| 'balanced' \| 'spacious' | 'balanced' |  | visual density; inherited from list context if unset |
