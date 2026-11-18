# Chat
Group: Chat. Category: Chat.
Import: import { Chat } from '@astryxdesign/core';

AI chat components. Layout (MessageList>Message>Bubble+SystemMessage) + Composer (shell w/ slots, ContentEditable input w/ trigger menus, tokens, msg history, attachments)

## Do
- MessageList > Message > Bubble for sender-aware styling.
- Density prop controls global spacing: compact for sidebars, balanced default, spacious for reading.
- gap tunes top-level row spacing separately from density for independent LLM/tool-event rows.
- Group prop on bubbles (first/middle/last) for consecutive same-sender messages; tightens corner radius.
- SystemMessage: divider variant for date breaks, default for status notices.
- Name on first bubble, metadata on last; aligns with bubble inline padding.
- Ghost bubble wraps custom content (cards/attachments); width="100%" spans full message column (default cap max(80%,280px)).
- Provide emptyState so new users see a prompt, not a blank screen.
- Ghost bubble variant for rich AI content like code/markdown without visible boundary.

## Do not
- SystemMessage for sender content: no avatar/alignment/bubble. Use ChatMessage instead.
- Long/multi-line system messages: keep to a single short sentence.
- Nesting ChatMessage inside another: each is a standalone article.
- Fixed height on message list directly: wrap in a sized container, let flex: 1 fill.
- Mix filled and ghost variants in same sender's messages: pick one style per side.
- Metadata/names on both bubble and wrapper: pick one.

## Parts
- ChatMessageList
- ChatMessage
- ChatMessageBubble
- ChatMessageMetadata
- ChatSystemMessage
- ChatComposer
- ChatComposerInput
- ChatComposerDrawer
- ChatSendButton
- ChatToolCalls
- ChatTokenizedText
- ChatComposerTokenElement
- ChatLayout
- ChatLayoutScrollButton
