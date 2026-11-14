import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The home screen frames this app without popups (T86, after T85's finding 1: a new tab is a way off this Mac). So
// the client never opens a window: "Open full size" is a view inside the app and a download stays a download.
const CLIENT = dirname(fileURLToPath(import.meta.url));
const APP = join(CLIENT, '..', '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.(tsx?|css|html)$/.test(e.name) && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

test('the client opens no window: no window.open and no target="_blank" anywhere in its source', () => {
  const files = [...sources(CLIENT), join(APP, 'index.html')];
  assert.ok(files.length > 40, `the client's files were found (${files.length})`);
  const found: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (/\b(window|globalThis|self|top|parent)\s*\.\s*open\s*\(/.test(text)) found.push(`${relative(APP, f)}: window.open`);
    if (/_blank/.test(text)) found.push(`${relative(APP, f)}: _blank`);
  }
  assert.deepEqual(found, []);
});

test('"Open full size" is the in-app view everywhere it is offered', () => {
  const pages = ['LocationPage.tsx', 'UpscaleStill.tsx', 'StillsPage.tsx', 'VideoPage.tsx'];
  for (const p of pages) {
    const text = readFileSync(join(CLIENT, p), 'utf8');
    assert.match(text, /<FullSize\b/, p);
    assert.doesNotMatch(text, />\s*Open full size\s*</, `${p} has no button of its own for it`);
  }
  const full = readFileSync(join(CLIENT, 'ui', 'FullSize.tsx'), 'utf8');
  assert.match(full, /<Lightbox\b/);
  assert.match(full, /Open full size/);
});
