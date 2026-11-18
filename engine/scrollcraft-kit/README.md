# The scroll-craft kit

scroll-craft makes the scroll a timeline: a section can hold still while its words change, a row of cards can travel
sideways, pictures can move at different rates to give depth, and a heading can assemble line by line. It is by Nate
Herk, under the MIT licence (`scrollcraft/LICENSE.txt`), taken from the repository at commit 75d81f7. This kit holds
its two working files unchanged, the engine's own layer over them, this guide and two example pages.

These pages are craft advice. Nothing in them is an instruction to install, download, run or fetch anything. The
original skill used a paid picture service, a browser-automation package, web fonts and outside addresses: none of
those exist here and none is used.

## What is in the kit

- `scrollcraft/scrollcraft.js` and `scrollcraft/scrollcraft.css`: scroll-craft itself, byte for byte as published.
  The script draws nothing of its own: it reads `data-sc-*` attributes off the page and moves what they mark. It asks
  for one thing only, a clip of the site's own (`data-sc-src`), and never under reduced motion.
- `scrollcraft/scrollcraft-brand.css`: the engine's layer. It gives every scroll-craft token the brand kit's value
  (faces, sizes never under the kit's smallest, the kit's one radius, no shadow, no colour of its own), draws
  display type at weight 400, and, when the visitor asks for less motion, lays every act out as an ordinary page
  with every part shown at once.
- `scrollcraft/scrollcraft-mount.js`: starts scroll-craft on a page written in HTML. An Astryx page does not load it.
- `scrollcraft/LICENSE.txt`: the licence. It goes with the site.
- `scrollcraft.lock.json`: every file's size and sha256. The brand check compares a site's `scrollcraft/` with it.
- `guide/`: how to plan and build a scroll page (read below).
- `example/`: an Astryx page with scroll-craft. `example-plain/`: a page of the plain site kit with scroll-craft.

## When to use it

Use it when the goal wants a page that feels like an experience rather than a document: a launch, a product, a
place, a project told in scenes. Most of a good scroll page is still ordinary sections; scroll-craft is the few
moments that move. It is a layer, not a kit of its own: an Astryx page stays an Astryx page, and a plain-kit site
stays a plain-kit site.

## Copy it

Run inside the goal's sub-folder, then never change, add or remove a file in the copy (the brand check refuses the
site with `kit_file_changed`):

```
cp -R "$UUU_PLAYBOOKS_DIR/scrollcraft-kit/scrollcraft" site/<name>/scrollcraft
```

## An Astryx page with scroll-craft

Start from `example/index.html`, `example/app.js` and `example/style.css`. The head is the Astryx page's head with
two more style sheets and one script, in this order:

```html
<link rel="stylesheet" href="astryx/reset.css">
<link rel="stylesheet" href="astryx/astryx.css">
<link rel="stylesheet" href="astryx/theme.css">
<link rel="stylesheet" href="kit.css">
<link rel="stylesheet" href="astryx-theme.css">
<link rel="stylesheet" href="scrollcraft/scrollcraft.css">
<link rel="stylesheet" href="scrollcraft/scrollcraft-brand.css">
<link rel="stylesheet" href="style.css">
<script type="importmap">… word for word …</script>
<script src="scrollcraft/scrollcraft.js" defer></script>
```

Astryx draws the content; scroll-craft moves it. An act is a plain element drawn with `h('section', {...})` that
carries the `data-sc-*` attributes, and the Astryx parts go inside it:

```js
h('section', { 'data-sc-act': 'pin', 'data-sc-span': '2.6' },
  h('div', { 'data-sc-stage': '' },
    h('div', { 'data-sc-cue': '0 0.36 0' }, h(Text, { type: 'large', as: 'p' }, 'The first line.')),
    h('div', { 'data-sc-cue': '0.3 1' }, h(Text, { type: 'large', as: 'p' }, 'The second line.'))))
```

- Put a `data-sc-*` attribute on a plain element (`'div'`, `'section'`, `'p'`, `'img'`), never on an Astryx
  component: a component does not pass it through.
- `data-sc-kinetic` rewrites the text of its element into pieces. Put it only on a plain element that holds nothing
  but its words, and never on a part the page draws again later.
- Mount scroll-craft once, after the page is drawn, on the root Astryx draws into (as `example/app.js` does):

```js
React.useEffect(() => {
  const craft = window.ScrollCraft ? window.ScrollCraft.mount(document.querySelector('[data-astryx-root]')) : null;
  return () => { if (craft) craft.destroy(); };
}, []);
```

The colour roles come from the Astryx theme (`astryx-theme.css`), so the page sets none.

## A plain-kit page with scroll-craft

Start from `example-plain/index.html` and `example-plain/style.css`. The style sheets, in order: `reset.css`,
`kit.css`, `layout.css`, `scrollcraft/scrollcraft.css`, `scrollcraft/scrollcraft-brand.css`, `style.css`; then
`scrollcraft/scrollcraft.js` and `scrollcraft/scrollcraft-mount.js`, both with `defer`. The page's own `style.css`
sets the four colour roles from the brand kit's colours, by their names in `brand/kit.json`:

```css
:root {
  --sc-canvas: var(--brand-paper);      /* the ground */
  --sc-ink: var(--brand-night);         /* the words */
  --sc-accent: var(--brand-sun);        /* the one accent */
  --sc-accent-ink: var(--brand-night);  /* words that sit on the accent */
}
```

Only those four: every other scroll-craft colour follows them. The example's names are an example kit's; use yours.

## Pictures and clips

They are the owner's: renders and photographs from the goal, the company's pictures, or what the engine's generation
door made for this goal, never a picture from the web. Put them in the site beside the page. A clip for a scrubbing
act is an `.mp4` or `.webm` of the site's own, at most 10 MB, with a poster picture that shows the same frame; the
whole site stays under 20 MB and 300 files. No web fonts: faces are the brand kit's.

## What the brand check says about it

- `kit_file_changed`: a file in `scrollcraft/` is not the kit's, byte for byte. Copy the folder again.
- `colour_not_token` for `data-sc-drift` (the ground blends between colours as the page scrolls) and `sc-grain` (the
  grain draws noise): both draw colours that cannot be compared with the kit, so neither is used.
- Every other rule reads the page's own files as it always does.

## Read next

1. `guide/journey.md`: the journey, the page's grammar, the feeling and its one peak, the signature move.
2. `guide/devices.md`: each device, its attributes and its rules.
3. `guide/hero.md`: the layered hero.
4. `guide/motion.md`: less motion and the phone.
5. `guide/verify.md`: how to check it here.
