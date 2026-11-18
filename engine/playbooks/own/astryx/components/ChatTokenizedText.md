# ChatTokenizedText
Import: import { ChatTokenizedText } from '@astryxdesign/core';

renders text w/ literal token values replaced by inline content; empty values ignored

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | string |  | yes | plain text msg w/ serialized token values; matching patterns become inline content |
| tokens | ChatComposerToken[] |  |  | token defs; literal values matched in caller order; empty values ignored |
| xstyle | StyleXStyles |  |  | additional StyleX styles for root wrapper |

## Do
- Reuse composer token definitions for display.
- Use stable non-empty serialized values.

## Do not
- Replace the surrounding message meaning with token labels.
- Move component-owned behavior into custom token renderers.
