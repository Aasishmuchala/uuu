# ChatMessageMetadata
Import: import { ChatMessageMetadata } from '@astryxdesign/core';

composable metadata row; renders timestamp · footer · status; reverses for user sender

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| timestamp | ReactNode |  |  | timestamp content; string or Timestamp |
| footer | ReactNode |  |  | footer content; model info, reaction btns, copy btn |
| status | 'sending' \| 'sent' \| 'delivered' \| 'read' \| 'error' |  |  | delivery status; shows icon+label |

## Do
- Put metadata in the last bubble metadata slot when the message uses bubbles, so it follows the bubble content.
- Pass timestamp and footer content independently; separators are omitted for non-rendering scalar slots. Composite React nodes are used as supplied.

## Do not
- Do not supply footer actions without their own accessible names and interaction behavior; the metadata row does not own those controls.
- Do not put the same metadata on both a bubble and its enclosing message.
