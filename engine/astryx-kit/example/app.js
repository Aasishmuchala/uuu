// The example page, drawn with Astryx. Copy this file and change the words and the parts.
// No JSX and no build step: h(Component, props, ...children) is React.createElement.
// Colours, faces and sizes come from the theme (kit.css and astryx-theme.css), never from here.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  Card,
  Grid,
  Heading,
  Link,
  Section,
  Text,
  VStack,
  registerIcons,
} from '@astryxdesign/core';
import { neutralIconRegistry } from '@astryxdesign/theme-neutral';

const h = React.createElement;

// The theme's own icons for every component that shows one. No provider is needed.
registerIcons(neutralIconRegistry);

const cards = [
  { key: 'first', title: 'First card', words: 'The first of three cards. Put one short point here.' },
  { key: 'second', title: 'Second card', words: 'The second card. Cards are for separate items of the same kind.' },
  { key: 'third', title: 'Third card', words: 'The third card. On a phone the cards stand one under another.' },
];

// Part one: the heading, a sentence and the one main action.
function Opening() {
  const [pressed, setPressed] = React.useState(false);
  return h(
    Section,
    { variant: 'transparent', paddingBlock: 10, paddingInline: 0 },
    h(
      VStack,
      { gap: 4, hAlign: 'start' },
      h(Heading, { level: 1, type: 'display-2' }, 'The example page'),
      h(
        Text,
        { type: 'large', as: 'p' },
        'This page shows the parts an Astryx page is made of. Change these words for the page you are making.',
      ),
      h(Button, { label: 'The main action', variant: 'primary', onClick: () => setPressed(true) }),
      pressed ? h(Text, { type: 'supporting', as: 'p' }, 'The button was pressed.') : null,
    ),
  );
}

// Part two: three cards, one column on a phone and three across on a wide screen.
function Cards() {
  return h(
    Section,
    { variant: 'transparent', paddingBlock: 8, paddingInline: 0 },
    h(
      VStack,
      { gap: 5 },
      h(Heading, { level: 2 }, 'Three cards'),
      h(
        Grid,
        { columns: { minWidth: 240, max: 3 }, gap: 4 },
        cards.map((card) =>
          h(
            Card,
            { key: card.key },
            h(
              VStack,
              { gap: 2 },
              h(Heading, { level: 3 }, card.title),
              h(Text, { as: 'p' }, card.words),
            ),
          ),
        ),
      ),
    ),
  );
}

// Part three: a closing section with a sentence and a link to a file of the site.
function Closing() {
  return h(
    Section,
    { variant: 'transparent', paddingBlock: 8, paddingInline: 0, dividers: ['top'] },
    h(
      VStack,
      { gap: 3, hAlign: 'start' },
      h(Heading, { level: 2 }, 'The closing part'),
      h(Text, { as: 'p' }, 'A last sentence for the page. The kit is built from Astryx, whose licences go with the site.'),
      h(Link, { href: 'astryx/LICENSES.txt', isStandalone: true }, 'The licences of the kit'),
    ),
  );
}

function Page() {
  return h(React.Fragment, null, h(Opening), h(Cards), h(Closing));
}

createRoot(document.querySelector('[data-astryx-root]')).render(h(Page));
