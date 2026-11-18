# useClickableContainer
Category: interaction.
Import: import { useClickableContainer } from '@astryxdesign/core';

Makes container element clickable while preserving nested interactive element behavior. Solves "nested interactive elements" problem: when card is clickable but contains buttons/links, clicking those must NOT trigger card's action. Detects interactive ancestors between click target + container, ignores text selections. Supports href navigation (incl. middle-click + Ctrl/Cmd+click for new tabs).

## Do
- Attach onClick + onMouseUp + onPointerDown to container element: full click handling incl. middle-click, no touch pressed state for press on nested control.
- Use inside ClickableCard / SelectableCard for standard card interaction pattern.
- Pressable surface w/o Card chrome (e.g. quoted message jumping on press): this hook on surface; usePressFeedback() + interactionOverlayStyles.backgroundColor on same element; native <button> (or <a> for destination) inside VisuallyHidden as named control + interactiveRef; focusOutlineStyles.focusWithin on surface for shared focus ring (the one ClickableCard draws). Full recipe: Core/Hooks/useClickableContainer story.

## Do not
- Use when entire container is single interactive element; just use <button> / <a> directly.

## See also
- ClickableCard
- SelectableCard
- useInputContainer
