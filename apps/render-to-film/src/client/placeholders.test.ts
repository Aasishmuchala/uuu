import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// A placeholder that shows sample content must read as a sample, never as data the owner
// entered: "For example: ..." (round-1 critics found "12.9716", "Koramangala, Bengaluru" and a
// whole story read as filled in). Any other placeholder is an instruction, listed here.
const CLIENT = dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS = new Set([
  'Jump to a screen or a picture',
  'A tag, then press Enter',
  'Add a tag, then press Enter',
  'Search your directions',
  'Search, or type @tag',
  'Filter by tag',
]);

function tsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsx(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

test('every sample placeholder starts "For example"', () => {
  const bad: string[] = [];
  let seen = 0;
  for (const file of tsx(CLIENT)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/placeholder="([^"]*)"/g)) {
      seen += 1;
      const words = m[1] ?? '';
      if (!words.startsWith('For example') && !INSTRUCTIONS.has(words)) bad.push(`${relative(CLIENT, file)}: "${words}"`);
    }
  }
  assert.ok(seen >= 15, `found only ${seen} placeholders; the pattern no longer matches the source`);
  assert.deepEqual(bad, []);
});
