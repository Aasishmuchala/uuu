import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// The native packages are prebuilt files inside their packages (no install script ran).
// rollup, esbuild and fsevents are not the app's own dependencies, so each is reached
// from the package that brings it in.
const appRequire = createRequire(join(process.cwd(), 'package.json'));
const from = (owner: string) => createRequire(realpathSync(appRequire.resolve(`${owner}/package.json`)));

test('sharp resizes a 2 x 2 PNG', async () => {
  const sharp = appRequire('sharp');
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } }).png().toBuffer();
  const out = await sharp(png).resize(1, 1).png().toBuffer();
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1);
  assert.equal(meta.height, 1);
});

test('esbuild strips a type', () => {
  const esbuild = appRequire('esbuild');
  const r = esbuild.transformSync('let a: number = 1', { loader: 'ts' });
  assert.match(r.code, /let a = 1/);
});

test('rollup parses export default 1', () => {
  const rollupParse = from('vite')('rollup/parseAst');
  const ast = rollupParse.parseAst('export default 1');
  assert.equal(ast.type, 'Program');
  assert.equal(ast.body[0].type, 'ExportDefaultDeclaration');
});

test('fsevents loads', () => {
  const fsevents = from('vite')('fsevents');
  assert.equal(typeof fsevents.watch, 'function');
});
