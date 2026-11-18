# The layered hero

Adapted from scroll-craft's page on hero depth (MIT, Nate Herk). On a marketing page the first screen has depth: a
background, a subject and a foreground that move at different rates and overlap, with the heading readable and one
clear story. One beautiful picture with words fading over it is not enough.

## Plan the planes first

- Name the planes back to front: a far plane, a mid plane, the subject (the building, the product, the person), a
  foreground in front of it. Say what moves on its own, what overlaps, and what must stay touching (a person on the
  rock, a product on its plinth).
- Give the visitor one change in a short scroll: the camera moves in, the heading settles, a second line arrives,
  the scene hands over to the next section.
- Rates differ by ten to thirty percent between neighbouring planes. More reads as things sliding about. The words
  ride at the page's own speed.

## Make the planes from the owner's pictures

The planes come from the owner's renders or photographs, or from the engine's generation door for this goal, never
from the web. For one scene:

1. A clean back plate with the subject taken out and the space behind it filled, or the moving cut-out shows a
   double or a hole.
2. The subject and the foreground as real cut-outs with transparency (a PNG or WebP with an alpha channel; a white
   or checked background is not transparency). Look at the edges against a contrasting ground.
3. The same framing, scale, light and camera on every plane.
4. Every plane solid below its outline, so the plane behind never shows through underneath as they separate.

## Build it

```html
<section data-sc-act="pin" data-sc-span="2.2">
  <div data-sc-stage>
    <img class="sc-stage__poster hero-plane" src="hero-back.png" alt="" data-sc-parallax="-1.2">
    <img class="hero-plane hero-plane--front" src="hero-front.png" alt="" data-sc-parallax="0.6">
    <div class="sc-scrim sc-scrim--band"></div>
    <div class="sc-copy sc-copy--lead" data-sc-cue="0 0.85 0"> heading, one sentence, the main action </div>
  </div>
</section>
```

- The planes are `position: absolute; inset: 0; max-width: none; object-fit: cover`. A global
  `img { max-width: 100% }` shrinks an absolute plane on a phone.
- A plane carries no `transition: transform`: it would trail behind the scroll.
- The scrim is a sibling of the copy, pointed at it (`sc-scrim--band`, `--lead`, `--trail`, `--bottom`, `--left`,
  `--right`), never a dark layer over the whole picture.
- The heading greets (`0 0.85 0`): the first screen always has its words.
- A new picture gets a new file name.

## On a phone

Do not shrink the desktop scene: change the crop, the subject's place, the heading's size, the order of the planes
and the travel. The heading may sit above the subject on a phone where it passes behind it on a wide screen. Nothing
is pushed off the screen or wider than it.

## When less motion is asked

The scene stays: the planes stand still, layered as they are, and the copy sits on them. No part waits for the
scroll (`motion.md`).

## Look before you call it done

The opening, a middle position and the hand-over to the next section, on a wide screen and a phone: the planes move
at different rates, no double, hole, halo or floating subject, the heading reads, and the scene resolves into what
follows. Say what you could not see.
