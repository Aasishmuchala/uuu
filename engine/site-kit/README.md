# The site kit

The site kit is this engine's own: four small files written in this repository for the pages the Builder makes,
with no third party's text and so no licence to carry. The playbooks installer copies them, with this file, to
`site-kit/` in the playbooks folder, where every agent may read them and none may change them. Nothing in them
fetches anything, and they name no address. A library that is not here is not used.

## What each file is

- `reset.css`: takes away the browser's odd defaults. It sets no colour of its own (only `inherit`,
  `currentColor` and `transparent`), the brand kit's body face (`var(--brand-body)`) on the page, and text
  never under the brand kit's smallest size. Headings keep the body's size and weight until the page's own style
  sheet sizes them and gives them `var(--brand-heading)`.
- `layout.css`: a spacing scale, `--space-1` (0.25rem) to `--space-8` (4.5rem); `.kit-container`, the page's
  content centred with the brand kit's margin on both sides; `.kit-section` and `.kit-stack` for room between
  parts; and `.kit-grid`, a 12-column grid whose children take `.span-1` to `.span-12`. Under 390 px every span
  takes the whole row; from 390 px the spans 1 to 3 go two to a row; from 768 px each `.span-N` takes its N
  columns; from 1280 px the gap grows. It also holds the two states of the scroll reveal and the lightbox's
  layout. It sets no colour of its own.
- `reveal.js`: every element with `data-reveal` fades in as it comes onto the screen, once. Every part is shown at
  once when the visitor asks for less motion, and when the page viewer opens the page (it takes pictures of the
  whole page and never scrolls).
- `gallery.js`: a link with `data-gallery` that points at a picture of the site opens it large in a `<dialog>`,
  with the `alt` of the picture inside the link as its caption. Links with the same `data-gallery` value are one
  gallery: the arrow keys go back and next, Escape closes, and focus goes back to the link. A link to anything
  else stays an ordinary link.

## How to use it

Copy the `.css` and `.js` files the page uses to the site's top, beside `kit.css`, unchanged. Never copy this
`README.md` into a site: the page viewer takes no `.md` file. Then link them in this order:

```html
<link rel="stylesheet" href="reset.css">
<link rel="stylesheet" href="kit.css">
<link rel="stylesheet" href="layout.css">
<link rel="stylesheet" href="style.css">
...
<script src="reveal.js" defer></script>
<script src="gallery.js" defer></script>
```

In the page's own `style.css`:

- Put the page's ground and text colours on `body`, from the kit's `--brand-` colours (the lightbox takes the
  same ground).
- Give headings `font-family: var(--brand-heading)` and sizes such as `font-size: max(var(--brand-min-size), 2.5rem)`.
- When `layout.marginShare` in `brand/kit.json` is not 0.06, set it: `:root { --kit-margin-share: 0.08; }`.

A grid of three cards, one under the other on a phone and three across from 768 px:

```html
<div class="kit-container kit-section">
  <ul class="kit-grid" role="list">
    <li class="span-4" data-reveal>...</li>
    <li class="span-4" data-reveal>...</li>
    <li class="span-4" data-reveal>...</li>
  </ul>
</div>
```

A gallery of two pictures of the site:

```html
<a href="pictures/tower.jpg" data-gallery="tower"><img src="pictures/tower-small.jpg" alt="The tower at dusk"></a>
<a href="pictures/lobby.jpg" data-gallery="tower"><img src="pictures/lobby-small.jpg" alt="The lobby in the morning"></a>
```
