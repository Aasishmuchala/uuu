import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The owner's banned list, held in the source (PLAN-APPS-ASTRYX, "Rules for every builder" and
// "The shared look"): no em dash, no upper-case labels, no mono face, no 01/02/03 counters, no
// colour but the kit's tokens, no gradient but the scrims, and no outside address. Every colour
// and the two scrims live in styles/studio.css, the one file allowed to name a colour.
const CLIENT = dirname(fileURLToPath(import.meta.url));
const STUDIO = 'styles/studio.css';

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.(tsx?|css)$/.test(e.name) && !e.name.endsWith('.test.ts') && e.name !== 'astryx.d.ts') out.push(p);
  }
  return out;
}

type Check = {
  name: string;
  pattern: RegExp;
  applies?: (file: string) => boolean;
  allow?: (match: string) => boolean;
};

const CHECKS: Check[] = [
  { name: 'no em dash', pattern: /—/ },
  { name: 'no upper-case text transform', pattern: /text-transform\s*:\s*uppercase|textTransform\s*:\s*['"]uppercase['"]/ },
  { name: 'no mono face', pattern: /monospace|GeistMono|font-mono/ },
  { name: "no 01/02/03 counters (padStart(2, '0') in a screen)", pattern: /padStart\(\s*2\s*,\s*['"]0['"]\s*\)/, applies: (f) => f.endsWith('.tsx') },
  { name: 'no hex colour outside studio.css', pattern: /#[0-9a-fA-F]{3,8}\b/, applies: (f) => f !== STUDIO },
  { name: 'no rgb() or hsl() colour outside studio.css', pattern: /\b(rgba?|hsla?)\(/, applies: (f) => f !== STUDIO },
  { name: 'no gradient outside studio.css', pattern: /(linear|radial)-gradient/, applies: (f) => f !== STUDIO },
  { name: 'no outside address', pattern: /https?:\/\/\S*/, allow: (m) => m.startsWith('http://www.w3.org/') },
];

// Every check holds now that the old look is gone (T3 and T5 emptied this set).
const TODO = new Set<string>([]);

const files = sources(CLIENT).map((f) => relative(CLIENT, f).split(sep).join('/'));

test('the client source was found', () => {
  assert.ok(files.length > 10, `the client's files were found (${files.length})`);
  assert.ok(files.includes('kit.ts') && files.includes(STUDIO), 'kit.ts and styles/studio.css are walked');
});

for (const check of CHECKS) {
  const todo = TODO.has(check.name) ? 'the old look is removed by the redesign tasks' : undefined;
  test(check.name, { todo }, () => {
    const found: string[] = [];
    for (const f of files) {
      if (check.applies && !check.applies(f)) continue;
      const lines = readFileSync(join(CLIENT, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(new RegExp(check.pattern.source, 'g'))) {
          if (check.allow?.(m[0])) continue;
          found.push(`${f}:${i + 1}: ${m[0]}`);
          break;
        }
      });
    }
    assert.deepEqual(found, []);
  });
}
