# Less motion, and the phone

## When the visitor asks for less motion

Some visitors ask their computer for less motion, and the page viewer asks for it too when it takes its pictures of
the whole page, because it never scrolls. So the page shows every part at once when less motion is asked, laid out
as an ordinary page. The kit does this for you:

- scroll-craft itself stops every movement (no rise, no parallax, no sideways travel, no wipes, no pointer effects)
  and never loads a clip: the poster is the picture;
- `scrollcraft-brand.css` then un-pins every act: its stage becomes an ordinary block at least a screen high, the
  copy sits in it in reading order at the bottom, every cue, every fade-in and every assembling line is shown, and
  a sideways rail wraps onto as many rows as it needs.

What that asks of the page:

- Write every act so that it reads well as an ordinary block: the lines of a pinned argument in reading order, the
  rail's items in order, the copy after the planes it sits on.
- Every word on the page is in the page, never only in a clip or a picture.
- Do not undo it in `style.css`: no `display`, `visibility`, `opacity`, `position` or `transform` of your own under
  `prefers-reduced-motion`, and nothing hidden for it. The brand check refuses a part shown or hidden by whether less
  motion is asked (`hidden_content`).
- Words over a picture still need a scrim, since the picture stays.
- A counter outside the acts shows its final figure; one inside a pinned act shows its first.

## On a phone

- Compose the phone separately. The kit's copy anchors re-flow under 860 px to the full width; a trailing scrim turns
  into a band at the bottom. Check that the copy and its scrim still meet.
- A scrubbing act takes a phone clip cut for a tall screen (`data-sc-src-mobile`), lighter than the desktop one.
- A rail's items take `min(26rem, 80vw)` or similar, so one item never runs wider than the phone.
- Tap targets are at least 44 px; the main action is never only a hover effect.
- Spans that feel right on a wide screen can feel long on a phone: an act's span is screen heights, so a phone gives
  the same number of screens with less on each. Keep spans honest.
- Nothing may be wider than the screen when less motion is asked: the page viewer lists anything that is.

The page viewer cannot be a real phone. It cannot show a phone's video decoder, its power saving or touch
scrolling. Say so in the report when a page leans on a clip.
