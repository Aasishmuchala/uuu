# The devices

Adapted from scroll-craft's device reference (MIT, Nate Herk). Each device is a different answer to "what does the
visitor's hand do here". Choose one per beat, never one for the whole page. Examples are written in HTML; on an
Astryx page write the same element with `h('section', { 'data-sc-act': 'pin', … }, …)` and put the Astryx parts
inside it.

## Acts

An act is the unit of scroll time: `<section data-sc-act="scrub | pin | pan | flow" data-sc-span="2.5">`.
`data-sc-span` is how many screen heights of scroll a pinned act (scrub, pin, pan) owns; default 1.5. A pinned act's
first `data-sc-stage` child (or `.sc-stage`) sticks to the top while the act scrolls. Each act publishes its
progress as `--sc-p` (0 to 1) on its own element. Never set `position` on a stage: it stops pinning.

## 1. scrub: the scroll plays a clip

```html
<section data-sc-act="scrub" data-sc-span="2.6" data-sc-dwell="0.35">
  <div data-sc-stage>
    <img class="sc-stage__poster" src="hero.jpg" alt="">
    <video data-sc-scrub data-sc-src="hero.mp4" data-sc-src-mobile="hero-phone.mp4" playsinline muted></video>
    <div class="sc-scrim sc-scrim--band"></div>
    <div class="sc-copy sc-copy--lead" data-sc-cue="0 0.62 0"><h1 class="sc-display sc-display--xl">…</h1></div>
  </div>
</section>
```

- A span of 2.2 to 3 for an opening act. Under 1.8 the clip flies past; over 3.5 it feels broken.
- `data-sc-dwell` (0 to 0.6) settles the camera in the middle of the act, where the words are.
- `data-sc-src`, not `src`: scroll-craft loads the clip itself, and never under reduced motion, when the poster is
  the picture. The poster must show the clip's first frame.
- At most two scrubbing acts on a page.
- A clip for scrubbing needs a key frame every few frames, no sound track, and a phone version cut for a tall
  screen. Ask for that when the generation door makes it.

## 2. pin: the frame holds, the words change

```html
<section data-sc-act="pin" data-sc-span="3">
  <div data-sc-stage class="argument">
    <p class="sc-lede" data-sc-cue="0 0.36 0">A first line.</p>
    <p class="sc-lede" data-sc-cue="0.30 0.66">A second line.</p>
    <p class="sc-lede" data-sc-cue="0.62 1">A third line.</p>
  </div>
</section>
```

The cheapest strong effect there is. A span of at least 1.2; below that the act snaps. The lines' windows overlap by
about a sixth of the act, so the screen is never empty.

### The cue: `data-sc-cue="from [to [rampIn [rampOut]]]"`

| Form | What it does |
|---|---|
| `"0.2"` | fades in at 0.2 and holds to the end of the act |
| `"0.1 0.6"` | in, holds, out; each ramp is 30% of the window |
| `"0 0.78 0"` | greets: already shown when the act begins, then fades |
| `"0 1 0 0"` | greets and holds |

- An opening act's first cue greets (third value `0`), or the first screen has no heading.
- Only the last act may end on a one-value cue that holds. Every other act ends its last cue at `1` with two values,
  or the line slides up over the next section.
- A pinned act shows a ground or a greeting cue from its first pixel: a picture, a held frame, or a first cue that
  greets.

## 3. pan: down the page, sideways on the screen

```html
<section data-sc-act="pan" data-sc-span="4">
  <div data-sc-stage>
    <div class="rail" data-sc-pan="0.08"> <div>A heading</div> <article>…</article> <article>…</article> … </div>
  </div>
</section>
```

Sideways reads as breadth: a range, a line-up, a timeline, never a ranking. The rail travels exactly how much wider
it is than the screen, so it must be wider at every width: at least half a screen wider at 1280 px. If three items
do not reach that, put the heading in as the first item and a closing note as the last. About one screen height of
span per item, plus one. Keep item headings to one or two short words: they are read half cut off at the edges.

## 4. reveal: a wipe is a change of state

`<figure data-sc-reveal="up" data-sc-reveal-at="0.15 0.55"><img src="…" alt="…"></figure>`, with `up`, `down`,
`left`, `right` or `iris` (iris at most once a page). Use it big, on a whole picture, for the beat where something
becomes something else. A wipe on type set tighter than `line-height: 1` cuts the letters: put it on a wrapper.

## 5. kinetic: type that assembles

`<h2 class="sc-display sc-display--lg" data-sc-cue="0.1 0.7" data-sc-kinetic="lines">…</h2>`. Lines nearly always;
words for a short punch line; letters never. One kinetic heading an act at most. It rewrites its element's text, so
on an Astryx page put it on a plain element holding only words.

## 6. parallax: layers at different rates

`data-sc-parallax="-1.2"` moves the element by `rate × (progress − 0.5) × 100` px across its act: usable rates are
about 0.3 to 1.5 for a layer in a frame and 1 to 2 for a full-width bed. Negative moves up faster and pushes it back.
Three layers are plenty. Never put words the visitor is reading on a moving layer. See `hero.md` for the layered
hero.

## 7. count: numbers that land

`<span data-sc-count="0 4,200">0</span>`, written as it should read. Only real figures from the company's files; a
new or fictional brand has none, so no counter. Put counters outside any act: there they tick up once as they come
into view and show the final figure at once when less motion is asked. Inside a pinned act they follow the scroll
and show their first figure in the page viewer's pictures.

## 8. flow and in: ordinary sections, done well

```html
<section class="sc-section"><div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="70">…</div></section>
```

Most of the page. `data-sc-in` fades a block in once as it arrives (a rise of about 14 px over 620 ms); a
`data-sc-stagger` of 30 to 80 ms leads the eye down its children. Without `data-sc-in` a stagger's children stay
hidden. A flow section straight after a pinned act takes less padding at its top.

## 9. Pointer devices

`data-sc-tilt="7"` (5 to 9 degrees), `data-sc-magnet="0.28"` (the main action only), `data-sc-spotlight`. They work
with a mouse only and never under reduced motion, so nothing may depend on them. A magnet, a parallax and a cue
cannot share one element: give the magnetic action `data-sc-rise="0"`.

## Not used here

- `data-sc-drift` (the page's ground blends between colours as it scrolls) and `.sc-grain` (noise): they draw
  colours that cannot be compared with the brand kit. The brand check refuses both. Give each section its own ground
  from the kit's colours instead.
- `data-sc-mode="worldflight"` (one fixed stage for the whole page): it cannot show every part when less motion is
  asked, and it needs a chain of matched clips.
- Colours written into attributes or styles: the colour roles come from the theme (`README.md`).

## Composing an act

Devices stack inside an act: a pinned stage can hold a clip, a moving layer, an assembling heading and a spotlight.
The limit is attention. One thing is the reason each act exists; if you cannot say it in one sentence, the act has
none.
