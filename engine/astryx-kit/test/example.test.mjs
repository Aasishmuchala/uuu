// Tests for the Astryx kit's example page and README (engine/astryx-kit/example/, engine/astryx-kit/README.md).
// They read the committed files only; nothing is written, nothing reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from '../../node_modules/acorn/dist/acorn.mjs';

const KIT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXAMPLE = path.join(KIT, 'example');
const read = (p) => fs.readFileSync(p, 'utf8');

const html = read(path.join(EXAMPLE, 'index.html'));
const app = read(path.join(EXAMPLE, 'app.js'));
const style = read(path.join(EXAMPLE, 'style.css'));
const importmap = read(path.join(KIT, 'astryx', 'importmap.json'));
const lock = JSON.parse(read(path.join(KIT, 'astryx.lock.json')));

const STYLESHEETS = [
  'astryx/reset.css',
  'astryx/astryx.css',
  'astryx/theme.css',
  'kit.css',
  'astryx-theme.css',
  'style.css',
];

test('index.html holds the import map word for word, inline, before every module script', () => {
  const opening = '<script type="importmap">\n';
  const at = html.indexOf(opening + importmap + '</script>');
  assert.ok(at > 0, 'the import map is not the exact text of astryx/importmap.json');
  assert.equal(html.split('type="importmap"').length, 2, 'one import map only');
  const firstModule = html.indexOf('type="module"');
  assert.ok(firstModule > at, 'the import map comes before every module script');
  assert.ok(at < html.indexOf('</head>'), 'the import map is in the head');
});

test('index.html links the six stylesheets in the fixed order and no other', () => {
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(links, STYLESHEETS);
  assert.equal((html.match(/<link\b/g) || []).length, 6);
});

test('index.html has its shape: the theme attribute, one root mark, a written header with the logo', () => {
  assert.ok(html.startsWith('<!doctype html>\n<html lang="en" data-astryx-theme="neutral">'));
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.equal(html.split('data-astryx-root').length, 2, 'exactly one data-astryx-root');
  assert.ok(html.includes('<main data-astryx-root></main>'));
  const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/);
  assert.ok(header, 'a <header> is written in the HTML');
  assert.match(header[1], /<img src="[^"]+"/);
  assert.ok(html.indexOf('<header') < html.indexOf('<main'), 'the header comes before the root');
  assert.ok(html.includes('<script type="module" src="app.js"></script>'));
});

test('index.html has no inline script but the import map, no inline style and no address', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1].trim());
  assert.deepEqual(scripts, ['type="importmap"', 'type="module" src="app.js"']);
  assert.ok(!/<style\b/i.test(html), 'no <style> element');
  assert.ok(!/\sstyle=/i.test(html), 'no style attribute');
  assert.ok(!/https?:|\/\/[a-z]/i.test(html), 'no address');
});

test('every name app.js imports from @astryxdesign/core is in the kit', () => {
  const ast = acorn.parse(app, { ecmaVersion: 'latest', sourceType: 'module' });
  const imports = ast.body.filter((n) => n.type === 'ImportDeclaration');
  const sources = imports.map((n) => n.source.value).sort();
  assert.deepEqual(sources, ['@astryxdesign/core', '@astryxdesign/theme-neutral', 'react', 'react-dom/client']);
  for (const decl of imports) {
    const file = { '@astryxdesign/core': 'core.js', '@astryxdesign/theme-neutral': 'theme-neutral.js' }[decl.source.value];
    if (!file) continue;
    const names = decl.specifiers.map((s) => s.imported.name);
    assert.ok(names.length > 0);
    for (const name of names) assert.ok(lock.exports[file].includes(name), `${name} is not in ${file}`);
  }
  const core = imports.find((n) => n.source.value === '@astryxdesign/core').specifiers.map((s) => s.imported.name);
  for (const name of ['Button', 'Card', 'Grid', 'Section', 'Text', 'Link']) assert.ok(core.includes(name), name);
});

test('app.js parses as a module, stays short and draws into the root mark', () => {
  assert.doesNotThrow(() => acorn.parse(app, { ecmaVersion: 'latest', sourceType: 'module' }));
  assert.ok(app.split('\n').length <= 121, 'at most 120 lines');
  assert.ok(app.includes('const h = React.createElement;'));
  assert.ok(app.includes("createRoot(document.querySelector('[data-astryx-root]')).render("));
  assert.ok(app.includes("variant: 'primary'"));
  assert.ok(!/\b(style|xstyle)\s*:/.test(app), 'no style or xstyle prop');
  assert.ok(!/<[A-Za-z]/.test(app.replace(/\/\/.*$/gm, '')), 'no JSX');
});

test('app.js and style.css hold no colour, no address, no fetch and no px', () => {
  for (const [name, text] of [['app.js', app], ['style.css', style]]) {
    assert.ok(!/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/.test(text), `${name}: a hex colour`);
    assert.ok(!/rgba?\(|hsla?\(/.test(text), `${name}: an rgb or hsl colour`);
    assert.ok(!/http/.test(text), `${name}: an address`);
    assert.ok(!/fetch\(/.test(text), `${name}: fetch`);
    assert.ok(!/px/.test(text), `${name}: px`);
  }
  assert.ok(style.split('\n').length <= 31, 'style.css at most 30 lines');
  assert.ok(!/font-family|(?<!-)color\s*:|background/.test(style), 'style.css sets no face and no colour');
});

test('the four example files and README.md are at most 64 KB each', () => {
  for (const name of ['index.html', 'app.js', 'style.css']) {
    assert.ok(fs.statSync(path.join(EXAMPLE, name)).size <= 64 * 1024, name);
  }
  const readme = path.join(KIT, 'README.md');
  assert.ok(fs.statSync(readme).size <= 64 * 1024, 'README.md');
  assert.deepEqual(fs.readdirSync(EXAMPLE).sort(), ['app.js', 'index.html', 'style.css']);
});

test('README.md names the page shape, the stylesheet order and what to avoid', () => {
  const readme = read(path.join(KIT, 'README.md'));
  assert.ok(readme.startsWith('# The Astryx kit\n'));
  let at = -1;
  for (const sheet of STYLESHEETS) {
    const next = readme.indexOf(`href="${sheet}"`);
    assert.ok(next > at, `${sheet} in order in the README`);
    at = next;
  }
  for (const words of ['data-astryx-root', 'LICENSES.txt', 'astryx-theme.css', 'about.html', './astryx/core.js',
    'engine/apps/README.md', 'COMPONENTS.md', 'React.Fragment', 'key:', 'data-theme="dark"', 'xstyle']) {
    assert.ok(readme.includes(words), words);
  }
  assert.ok(!/https?:\/\//.test(readme), 'no address in the README');
});
