# ChatToolCalls
Group: Chat. Category: Chat.
Import: import { ChatToolCalls } from '@astryxdesign/core';

tool/function call display from LLM response; single=inline, multiple=collapsible summary w/ latest at surface

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| calls | ChatToolCallItem[] |  | yes | tool call data array; name+status+target+duration+node+additions+deletions+resultDetail |
| label | string |  |  | custom summary label; auto from count if omitted |
| isExpanded | boolean |  |  | controlled expanded state |
| defaultIsExpanded | boolean | false |  | default expanded state (uncontrolled) |
| onExpandedChange | (isExpanded: boolean) => void |  |  | expanded state change callback |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value, not an inline style object like style={{}}. |

## Do
- Include target on every call: file path, command, or search query.
- Show duration on completed calls so users understand timing.
- Provide group label when count alone is ambiguous.
- Provide resultDetail with code blocks for calls that produce output.
- Set unique key on each call item when streaming for stable animations.

## Do not
- Don't omit status; defaults to complete, misleading for running/failed calls.
- Don't display outside chat message context; designed for assistant messages.
- Don't wrap individual calls; component handles single vs. grouped layout automatically.
