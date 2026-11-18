# useLightbox
Group: Lightbox. Category: interaction.
Import: import { useLightbox } from '@astryxdesign/core';

State management and accessible trigger wiring for Lightbox. Eliminates boilerplate for open state and index. Returns trigger props and pre-wired Lightbox element.

## Do
- Spread getTriggerProps(index) onto image or thumbnail elements to give them accessible button semantics and keyboard activation.
- Render lightbox.element once in your component JSX tree alongside the triggers.

## Do not
- Manage separate isOpen or index state alongside useLightbox; the hook already tracks both.
- Add custom click or keydown handlers to open the lightbox when using triggerProps or getTriggerProps.

## See also
- Lightbox
- Grid
- Thumbnail
