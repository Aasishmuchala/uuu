# usePressFeedback
Category: motion & gestures.
Import: import { usePressFeedback } from '@astryxdesign/core';

Marks an element as a pressable surface of the touch press model, tracked like a UIKit control (highlight as the finger lands, 150 ms inside a scroller, fade at the lift), and installs the shared document controller; on a coarse primary pointer it also paints mouse, trackpad and Space-key presses at once. Returns the data-astryx-pressable marker to spread; compose one of interactionOverlayStyles on the same element to paint.

## Do
- Spread the result on the element whose background paints the press and compose one of `interactionOverlayStyles` on it; the composed style is the instant onset, the hold and the fade, and it is themed through `--color-overlay-pressed`.
- Let the composed style own the press on every pointer: it keeps `:active` for a desktop mouse and drops it under `@media (pointer: coarse)`, where the controller paints every press (a finger through the press model, a mouse or Space key at once). A rule of your own that paints `:active` would paint under a finger too, on the touch and through a scroll.

## Do not
- Add a pointer listener or React state to the element to track the press; the controller already writes the attribute, and per-element listeners are what a long list cannot afford.
- Call it for a control rendered by an Astryx component; those are marked already, and the innermost marked element takes the press.

## See also
- Button
- Item
- ClickableCard
- useLongPress
