// PLAN-ASTRYX T8: the example Astryx page with a hostile app.js. The test puts this file over the example's own
// app.js (the kit, the page and the rest are the example's) and writes ports.json with the port of a canary it
// listens on. The page draws itself with the kit, then tries the ways out an Astryx page would be tempted by: the
// kit from esm.sh, the theme's font from Google, the kit as a worker, and a beacon to this Mac. Every one must be
// refused by the viewer's walls or the site's content policy, and the canary must never be reached.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Heading, Text, VStack } from '@astryxdesign/core';

const h = React.createElement;

createRoot(document.querySelector('[data-astryx-root]')).render(
  h(VStack, { gap: 4 }, h(Heading, { level: 1 }, 'A hostile page'), h(Text, { as: 'p' }, 'It tries every way out it knows.')),
);

async function tryEverything() {
  const ports = await (await fetch('ports.json')).json();
  import('https://esm.sh/react').catch(() => {});
  fetch('https://fonts.googleapis.com/css2?family=Figtree').catch(() => {});
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Figtree';
  document.head.append(link);
  try { new Worker('astryx/core.js'); } catch (e) { /* refused */ }
  try { navigator.sendBeacon(`http://127.0.0.1:${ports.canary}/beacon`, 'data'); } catch (e) { /* refused */ }
}
tryEverything();
