# useClipboard
Category: interaction.
Import: import { useClipboard } from '@astryxdesign/core';

Copy-to-clipboard behavior: clipboard write + transient isCopied flag with reset timer + optional polite SR announcement. One implementation shared by copy affordances instead of re-deriving timer/announce. Rapid re-copies restart the timer; timer cleaned up on unmount. CodeBlock/Timestamp build their copy buttons on it.

## Do
- Drive the copy → check confirmation off the returned isCopied, not your own state.
- Pass a localized announce so the copy is spoken (aria-label swap alone is not reliably announced).
- For a compact icon copy button, use a ghost IconButton with a "Copy" tooltip and wire onClick to copy(); the tooltip stays "Copy" and the icon flip is the confirmation.

## Do not
- Track a separate copied useState alongside the hook.

## See also
- CodeBlock
- Timestamp
- IconButton
- useAnnounce
