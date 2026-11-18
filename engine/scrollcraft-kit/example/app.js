// The example scroll page: Astryx draws the content, scroll-craft moves it with the scroll. Copy this file and change
// the words, the pictures and the acts. No JSX and no build step: h(Component, props, ...children) is
// React.createElement. An act is a plain element with data-sc-* attributes; the Astryx parts go inside it.
// Colours, faces and sizes come from the theme (kit.css, astryx-theme.css, scrollcraft-brand.css), never from here.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Card, Grid, Heading, Link, Section, Text, VStack, registerIcons } from '@astryxdesign/core';
import { neutralIconRegistry } from '@astryxdesign/theme-neutral';

const h = React.createElement;
registerIcons(neutralIconRegistry);

// Act one, the hero: a pinned stage of picture planes that move at different rates, with the copy on top.
// The planes are the owner's renders (or pictures from the generation door), cut into a back and a front plane.
function Hero() {
  return h(
    'section',
    { 'data-sc-act': 'pin', 'data-sc-span': '2.2' },
    h(
      'div',
      { 'data-sc-stage': '', className: 'hero' },
      h('img', { className: 'sc-stage__poster hero-plane', src: 'hero-back.png', alt: '', 'data-sc-parallax': '-1.2' }),
      h('img', { className: 'hero-plane hero-plane--front', src: 'hero-front.png', alt: '', 'data-sc-parallax': '0.6' }),
      h('div', { className: 'sc-scrim sc-scrim--band' }),
      h(
        'div',
        { className: 'sc-copy sc-copy--lead', 'data-sc-cue': '0 0.85 0' },
        h(
          VStack,
          { gap: 4, hAlign: 'start' },
          h(Heading, { level: 1, type: 'display-2' }, 'The example scroll page'),
          h(Text, { type: 'large', as: 'p' }, 'The first screen holds still while the pictures behind it move.'),
          h(Button, { label: 'The main action', variant: 'primary' }),
        ),
      ),
    ),
  );
}

// Act two, the argument: the frame holds and three lines take turns. The windows overlap, the first one greets,
// and the last one ends at 1 because this is not the last act.
function Argument() {
  return h(
    'section',
    { 'data-sc-act': 'pin', 'data-sc-span': '2.6' },
    h(
      'div',
      { 'data-sc-stage': '', className: 'argument' },
      h('div', { 'data-sc-cue': '0 0.36 0' }, h(Text, { type: 'large', as: 'p' }, 'The first line of the argument.')),
      h('div', { 'data-sc-cue': '0.3 0.68' }, h(Text, { type: 'large', as: 'p' }, 'The second line takes its place.')),
      h('p', { className: 'sc-display sc-display--md', 'data-sc-cue': '0.62 1', 'data-sc-kinetic': 'lines' },
        'The third line is the one to remember.'),
    ),
  );
}

// Act three, the range: the scroll goes down and the rail travels sideways. The heading is the first item.
const items = [
  { key: 'first', title: 'First item', words: 'One of the choices, in a sentence.' },
  { key: 'second', title: 'Second item', words: 'Another choice, said as plainly.' },
  { key: 'third', title: 'Third item', words: 'The last choice of the three.' },
];
function Range() {
  return h(
    'section',
    { 'data-sc-act': 'pan', 'data-sc-span': '4' },
    h(
      'div',
      { 'data-sc-stage': '', className: 'range' },
      h(
        'div',
        { className: 'rail', 'data-sc-pan': '0.08' },
        h('div', { className: 'rail-item' }, h(Heading, { level: 2 }, 'Three choices')),
        items.map((item) =>
          h('div', { className: 'rail-item', key: item.key },
            h(Card, null, h(VStack, { gap: 2 }, h(Heading, { level: 3 }, item.title), h(Text, { as: 'p' }, item.words))))),
      ),
    ),
  );
}

// Act four and the close: ordinary sections that fade in once, as they come onto the screen.
function Closing() {
  return h(
    'div',
    { className: 'sc-wrap' },
    h(
      Section,
      { variant: 'transparent', paddingBlock: 10, paddingInline: 0 },
      h(
        'div',
        { 'data-sc-in': '', 'data-sc-stagger': '70' },
        h(Heading, { level: 2 }, 'What holds it up'),
        h(Text, { as: 'p' }, 'An ordinary section after the moving ones. Most of a page is like this.'),
      ),
    ),
    h(
      Section,
      { variant: 'transparent', paddingBlock: 10, paddingInline: 0, dividers: ['top'] },
      h(
        Grid,
        { columns: { minWidth: 240, max: 2 }, gap: 6 },
        h(VStack, { gap: 3, hAlign: 'start' },
          h(Heading, { level: 2 }, 'The one action'),
          h(Text, { as: 'p' }, 'The last screen holds. It does not fade away.')),
        h(VStack, { gap: 3, hAlign: 'start' },
          h(Button, { label: 'The main action', variant: 'primary' }),
          h(Link, { href: 'scrollcraft/LICENSE.txt', isStandalone: true }, 'The licence of scroll-craft')),
      ),
    ),
  );
}

// scroll-craft is mounted once, after the page is drawn, on the root Astryx draws into.
function Page() {
  React.useEffect(() => {
    const craft = window.ScrollCraft ? window.ScrollCraft.mount(document.querySelector('[data-astryx-root]')) : null;
    return () => { if (craft) craft.destroy(); };
  }, []);
  return h(React.Fragment, null, h(Hero), h(Argument), h(Range), h(Closing));
}

createRoot(document.querySelector('[data-astryx-root]')).render(h(Page));
