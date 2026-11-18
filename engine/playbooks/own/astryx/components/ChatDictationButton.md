# ChatDictationButton
Group: Chat. Category: Chat.
Import: import { ChatDictationButton } from '@astryxdesign/core';

mic toggle btn for voice input in chat composer; idle=mic icon, listening=freq bars; pairs w/ useChatDictation

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| dictation | UseSpeechRecognitionReturn |  | yes | return from useChatDictation/useSpeechRecognition; controls state |
| size | 'sm' \| 'md' | 'md' |  | btn size |
| isHiddenWhenUnsupported | boolean | true |  | hide unsupported dictation; false keeps disabled btn visible |
| label | string |  |  | a11y label override |
| xstyle | StyleXStyles |  |  | extra StyleX styles |

## Do
- Place in sendActions slot of ChatComposer next to send button.
- Pass inputRef to useChatDictation for interim ghost text in input.
- Enable hasSounds for audio feedback on start/stop.

## Do not
- Don't use outside chat composer context. Designed for composer send-action layout only.
- Don't forget unsupported case. Button auto-hides but composer should work without it.
