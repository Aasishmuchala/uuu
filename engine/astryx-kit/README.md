# The Astryx kit

The Astryx kit is Meta's Astryx design system (`@astryxdesign/core` and `@astryxdesign/theme-neutral`, 0.7.16)
with React 19, built once on this Mac into a few plain files that a browser loads as they are. The playbooks
installer copies the kit to `astryx-kit/` in the playbooks folder, where every agent may read it and none may
change it. Nothing in the kit fetches anything: it names no address a page would load, it holds no font from the
web, and it needs no `npm`, no download and no build step. A page made with it reaches only its own site.

## What is in `astryx/`

- `react.js`, `react-dom.js`, `react-dom-client.js`, `jsx-runtime.js`: React, one copy for everything.
- `core.js`: every Astryx component (`Button`, `Card`, `Grid`, `Heading`, `Text` and the rest).
- `theme-neutral.js`: the neutral theme's parts for code (`neutralTheme`, `neutralIconRegistry`, `neutralPalettes`).
- `chunk-<letters>.js`: parts the files above share. A page never names them; the files above load them.
- `reset.css`, `astryx.css`, `theme.css`: the browser reset, the components' styles and the neutral theme.
- `importmap.json`: the import map a page copies into its head, word for word.
- `LICENSES.txt`: the licences of every package the kit is made from.

Copy the folder whole to the site's top, as `astryx/`, and never change, rename, add to or leave out a file of
it. The brand check knows every file by its sha256: a file that differs is a hard line (`kit_file_changed`).

## The shape of a page

`example/` is the page to copy: `index.html`, `app.js` and `style.css`. Copy them to the site's top, beside
`astryx/`, then change the words and the parts. The site also gets `kit.css` and `astryx-theme.css` from the
brand folder, byte for byte, and the logo the header names.

```html
<!doctype html>
<html lang="en" data-astryx-theme="neutral">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The page's name</title>
<link rel="stylesheet" href="astryx/reset.css">
<link rel="stylesheet" href="astryx/astryx.css">
<link rel="stylesheet" href="astryx/theme.css">
<link rel="stylesheet" href="kit.css">
<link rel="stylesheet" href="astryx-theme.css">
<link rel="stylesheet" href="style.css">
<script type="importmap">
(the text of astryx/importmap.json, word for word)
</script>
</head>
<body>
<header class="page-header"><img src="logo.svg" alt="The company's logo" height="32"></header>
<main data-astryx-root></main>
<script type="module" src="app.js"></script>
</body>
</html>
```

- The stylesheets go in that order: the kit's three, then the brand's two, then the page's own. The brand theme
  comes after the kit's so the brand wins.
- The import map is the only inline script, and it comes before every module script.
- The header is written in the HTML, with the logo as an `<img src>`, because the brand check reads the logo
  from the HTML text. Everything else is drawn by `app.js` inside the one `<main data-astryx-root>`. The page
  viewer waits for that element to have something in it before it takes its pictures.
- `style.css` holds the layout of the written shell only: the header, and the margin the drawn parts keep.

## Writing the page: `h(Component, props, ...children)`

Nothing compiles the page, so there is no JSX. `app.js` names React's `createElement` `h` and calls it:

```js
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Heading, VStack } from '@astryxdesign/core';
const h = React.createElement;
createRoot(document.querySelector('[data-astryx-root]')).render(
  h(VStack, { gap: 4 }, h(Heading, { level: 1 }, 'A title'), h(Button, { label: 'Go', variant: 'primary' })),
);
```

| JSX | The same with `h` |
|---|---|
| `<Card />` | `h(Card)` |
| `<Button label="Go" variant="primary" />` | `h(Button, { label: 'Go', variant: 'primary' })` |
| `<Card><Text>Hi</Text></Card>` | `h(Card, null, h(Text, null, 'Hi'))` |
| `{items.map(i => <Card key={i.id}>{i.name}</Card>)}` | `items.map((i) => h(Card, { key: i.id }, i.name))` |
| `<>{a}{b}</>` | `h(React.Fragment, null, a, b)` |

Props that are numbers stay numbers (`gap: 4`), not strings. A spacing prop takes a step of the scale (0, 0.5,
1, 1.5, 2, 3, 4, 5, 6, 8, 10), never a length.

`app.js` calls `registerIcons(neutralIconRegistry)` once, before it draws. That gives every component that
shows an icon the theme's own icons. No provider wraps the page: without one the components still draw, and
icons fall back to Astryx's small built-in set. Do not wrap the page in `Theme`: with the kit's `neutralTheme`
it writes a second copy of the theme's styles into the page as it runs, and its default mode follows the
visitor's dark setting.

## Finding a component

Read the playbook `astryx`: its `COMPONENTS.md` lists every component with one line on what it is for. Then
read `components/<Name>.md` for the one you want: its props, what to do, what not to do and an example. The
example is written in JSX; write it with `h` as in the table above. Use only components `core.js` holds; a name
that is not in the list does not exist here. Where a page tells you to install or run something, do not.

Some patterns worth knowing:

- Page regions are `Section`s; separate items of one kind are `Card`s.
- Rows of things that must work on a phone use `Grid` with `columns: { minWidth: 240, max: 3 }`, never a bare
  number of columns.
- One `Button` with `variant: 'primary'` in a view. A link that only goes to another page is a `Link`.
- Text is `Heading` (with `level`) and `Text` (with `type` and `as: 'p'` for a paragraph), not bare elements.

## The brand

`kit.css` and `astryx-theme.css` come from the brand folder, copied byte for byte, never written by hand. The
home server writes `astryx-theme.css` from the brand kit on every save: it sets every Astryx colour, face, size
and corner to the brand's. So colours and faces reach the page only through Astryx's tokens and the
components' own props (`variant`, `color`, `type`, `level`), never as a value of your own. Never set a
`--color-`, `--font-`, `--text-`, `--radius-` or `--shadow-` property anywhere, and never write a colour, a face
or a size in px in `app.js` or `style.css`. The brand check judges what the page draws: a colour that is not
the brand's fails it.

## What to avoid

- JSX, a build step, `npm` or any other installer, or a package that is not in `astryx/`.
- Any address: no `http`, no font or picture from the web, no `fetch` or other call to a server.
- A second copy of React, or React from anywhere but `astryx/`.
- The `style` and `xstyle` props for colour, face or size.
- `data-theme="dark"`, or a dark variant: the brand has one palette.
- Changing, renaming or leaving out a file of `astryx/`.
- An import map anywhere but in `index.html`'s head (and each other page's head).
- More than one `data-astryx-root` on a page.

## A second page

`about.html` repeats the whole head of `index.html` (the six stylesheets and the import map), keeps the same
written header, and names its own module: `<script type="module" src="about.js"></script>`. Parts both pages
use can live in a module of their own, such as `parts.js`, that each page's module imports by relative path
(`import { Footer } from './parts.js';`).

## An app in App Studio

An app is served under a policy that refuses inline scripts, so it has no import map. It copies `astryx/` into
its client folder and imports the kit's files by relative path, from the folder its page is in:

```js
import * as React from './astryx/react.js';
import { createRoot } from './astryx/react-dom-client.js';
import { Button, Card } from './astryx/core.js';
```

Its page links the same stylesheets in the same order. See `engine/apps/README.md` for how an app is made and
served.

## Licences

Astryx, React and the packages the kit is built from are under the MIT, ISC and BSD licences.
`astryx/LICENSES.txt` holds each one in full, and it goes with every site and app that carries the kit.
