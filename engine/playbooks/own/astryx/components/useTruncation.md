# useTruncation
Group: Text. Category: text.
Import: import { useTruncation } from '@astryxdesign/core';

Detects whether text is cut off (single-line overflow or -webkit-line-clamp) and returns the full text, updating on size and content changes. Shared Resize/Mutation observers keep hundreds of cells at one observer each; first measurement batches in a microtask after commit.

## Do
- Tooltip only when isTruncated; text from fullText.
- Apply the matching clamp (nowrap / line-clamp) next to the hook so view and measurement agree.
- One hook instance per measured element; the ref cleans up after itself.

## Do not
- Manual scrollHeight checks on clamped text — browsers report the clamped size.

## See also
- Text
- Heading
- Tooltip
