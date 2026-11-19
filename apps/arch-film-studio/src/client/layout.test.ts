import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Layout faults found in the round-1 stills, held in the source (the staging sweep checks the
// drawn page for cut text too: engine/apps/test/stage/sweep.mjs).
const CLIENT = dirname(fileURLToPath(import.meta.url));
const css = (p: string) => readFileSync(join(CLIENT, p), 'utf8');
const rule = (text: string, selector: string) => {
  const at = text.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule ${selector}`);
  return text.slice(at, text.indexOf('}', at));
};

test('a timeline block is wide enough for its picture and "Shot 10" with its dot', () => {
  // The block is 64 px tall: a 16:9 thumbnail is about 100 px, the label and dot about 70 px.
  const m = /min-width:\s*(\d+)px/.exec(rule(css('parts/ShotTimeline.module.css'), '.slot'));
  assert.ok(m && Number(m[1]) >= 176, `.slot min-width is ${m?.[1]} px`);
});

test('the batch bar sticks only where it is asked to, so it never covers the Storyboard fields', () => {
  const text = css('parts/SelectionBar.module.css');
  assert.doesNotMatch(rule(text, '.bar'), /position:\s*sticky/);
  assert.match(rule(text, '.bar[data-sticky]'), /position:\s*sticky/);
  assert.match(css('screens/Storyboard.tsx'), /<SelectionBar\s+sticky=\{false\}/);
});

test('the Overview cards are as tall as what they hold', () => {
  assert.match(rule(css('screens/Overview.module.css'), '.columns'), /align-items:\s*start/);
  assert.doesNotMatch(rule(css('screens/Overview.module.css'), '.nextRow'), /margin-top:\s*auto/);
});

test('a made clip plays in the app player, never under the browser controls and their spinner', () => {
  const tsx = css('screens/Storyboard.tsx');
  assert.match(tsx, /<FilmPlayer\s+clips=\{\[\{ src: clip,/);
  assert.doesNotMatch(tsx, /<video[^>]*\bcontrols\b/);
});

test('every caption puts the name on its own line', () => {
  assert.match(rule(css('parts/ContactSheet.module.css'), '.name'), /flex-basis:\s*100%/);
});
