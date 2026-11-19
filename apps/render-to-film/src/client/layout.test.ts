import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Bars that collided in the Mac app's web view (PLAN-DESKTOP T2's pictures, a 1030 and a 390 frame),
// held in the source.
const CLIENT = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(CLIENT, p), 'utf8');
const rule = (text: string, selector: string) => {
  const at = text.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule ${selector}`);
  return text.slice(at, text.indexOf('}', at));
};

test('the top bar keeps one line: Jump to and Shortcuts give way in a narrow frame, never overlap', () => {
  const css = src('App.module.css');
  assert.match(rule(css, '.jump'), /flex:\s*none/);
  assert.match(rule(css, '.crumbs'), /min-width:\s*0/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.jumpWords,\s*\.shortcuts \{\s*display: none;/);
  const tsx = src('App.tsx');
  assert.match(tsx, /className=\{styles\.jump\} onClick=\{\(\) => setPalette\(true\)\} aria-keyshortcuts="Meta\+K" aria-label="Jump to"/);
  assert.match(tsx, /<span className=\{styles\.shortcuts\}>/);
  // The chip shows its dot alone, its words its name and tooltip.
  assert.match(src('ui/SpendingChip.module.css'), /@media \(max-width: 760px\)[\s\S]*\.words \{\s*display: none;/);
  assert.match(src('ui/SpendingChip.tsx'), /role="status" tabIndex=\{0\} aria-label=\{a\.words\}/);
});

test('a stage toolbar wraps its actions whole rather than cut "Shoot the other 2 frames" or "Make a video"', () => {
  const css = src('parts/Stage.module.css');
  assert.match(rule(css, '.toolbar'), /flex-wrap:\s*wrap/);
  const actions = rule(css, '.actions');
  assert.match(actions, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(actions, /flex:\s*none/);
  assert.match(rule(css, '.actions > *'), /flex:\s*none/);
});

test('a price stays on the line of its button and never shrinks', () => {
  const css = src('ui/Price.module.css');
  assert.match(rule(css, '.price'), /flex:\s*none/);
  assert.match(rule(css, '.price'), /white-space:\s*nowrap/);
  assert.doesNotMatch(rule(css, '.buy'), /flex-wrap:\s*wrap/);
});

test('the Edit bars wrap rather than push Export film or the transition off the edge', () => {
  const css = src('EditPage.module.css');
  assert.match(rule(css, '.top'), /flex-wrap:\s*wrap/);
  assert.match(rule(css, '.timelineHead'), /flex-wrap:\s*wrap/);
  assert.match(rule(css, '.timelineHead > *'), /flex:\s*none/);
});
