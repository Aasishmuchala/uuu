// Tests for the Astryx kit (engine/astryx-kit/astryx/) and its build script.
// They read the committed kit and copy it to temp folders; they never write into the repo, never reach the network.
// The vendor folder is read and hashed only; nothing in it is imported or run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CALL_WORDS,
  FORBIDDEN,
  IMPORTMAP_TEXT,
  LIMITS,
  PACKAGES,
  readInputs,
  verify,
} from '../build.mjs';

const KIT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENGINE = path.dirname(KIT);
const BUILD = path.join(KIT, 'build.mjs');
const ASTRYX = path.join(KIT, 'astryx');
const VENDOR = '/Users/aasish/astryx-vendor/node_modules';
const ESBUILD = path.join(ENGINE, 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild');

// Pinned scans of the committed kit. An upgrade that adds an address or a network call must change these by hand.
const ADDRESSES = [
  'http://${a}',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/XML/1998/namespace',
  'https://astryx.invalid/',
  'https://react.dev/errors/',
];
const CALLS = {
  'fetch(': 1,
  XMLHttpRequest: 0,
  WebSocket: 0,
  EventSource: 0,
  sendBeacon: 0,
  importScripts: 0,
  'new Worker': 0,
  SharedWorker: 0,
  serviceWorker: 0,
  'eval(': 0,
  'new Function': 0,
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const lock = () => JSON.parse(fs.readFileSync(path.join(KIT, 'astryx.lock.json'), 'utf8'));

function run(args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BUILD, ...args], { env: { ...process.env, ...env }, timeout: 300000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// A copy of the kit root (astryx/ and astryx.lock.json) in a new temp folder.
function copyKit(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'astryx-kit-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(ASTRYX, path.join(root, 'astryx'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'astryx.lock.json'), path.join(root, 'astryx.lock.json'));
  return root;
}

test('--verify passes on the committed kit', async () => {
  const r = await run(['--verify']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Astryx kit: \d+ files, \d+ bytes, as listed\.\n$/);
  const l = lock();
  assert.equal(r.stdout, `Astryx kit: ${l.files.length} files, ${l.files.reduce((a, f) => a + f.bytes, 0)} bytes, as listed.\n`);
});

test('a byte changed in a copy of the kit fails verify, naming the file', (t) => {
  const root = copyKit(t);
  assert.equal(verify(root).ok, true);
  const f = path.join(root, 'astryx', 'core.js');
  const buf = fs.readFileSync(f);
  buf[100] = buf[100] === 0x41 ? 0x42 : 0x41;
  fs.writeFileSync(f, buf);
  const r = verify(root);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, ['core.js: sha256 differs from the list']);
});

test('an extra file, a missing file and a link each fail verify', (t) => {
  const root = copyKit(t);
  fs.writeFileSync(path.join(root, 'astryx', 'extra.js'), 'export {};\n');
  fs.rmSync(path.join(root, 'astryx', 'theme.css'));
  fs.symlinkSync('/etc/hosts', path.join(root, 'astryx', 'hosts.txt'));
  const r = verify(root);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems.sort(), [
    'extra.js: not in astryx.lock.json',
    'hosts.txt: not a plain file',
    'theme.css: listed but missing',
  ]);
});

test('importmap.json is the exact text', () => {
  const want = `{
  "imports": {
    "react": "./astryx/react.js",
    "react/jsx-runtime": "./astryx/jsx-runtime.js",
    "react-dom": "./astryx/react-dom.js",
    "react-dom/client": "./astryx/react-dom-client.js",
    "@astryxdesign/core": "./astryx/core.js",
    "@astryxdesign/theme-neutral": "./astryx/theme-neutral.js"
  }
}
`;
  assert.equal(IMPORTMAP_TEXT, want);
  assert.equal(fs.readFileSync(path.join(ASTRYX, 'importmap.json'), 'utf8'), want);
});

test('LICENSES.txt names every package and holds the MIT, ISC and BSD texts', () => {
  const text = fs.readFileSync(path.join(ASTRYX, 'LICENSES.txt'), 'utf8');
  assert.equal(PACKAGES.length, 12);
  for (const p of PACKAGES) assert.ok(text.includes(`==== ${p.name} `), `${p.name} is named`);
  assert.ok(text.includes('Permission is hereby granted'));
  assert.ok(text.includes('ISC License'));
  assert.ok(text.includes('BSD'));
  const note = "This package ships no licence file; its package.json says MIT and it is Meta's, as the package above.";
  assert.equal(text.split(note).length - 1, 2, 'the note is there for core and stylex');
});

test('the kit holds no forbidden word, no file over 2 MB, only allowed names, within the limits', () => {
  const names = fs.readdirSync(ASTRYX);
  assert.ok(names.length <= LIMITS.files);
  let total = 0;
  for (const name of names) {
    const st = fs.lstatSync(path.join(ASTRYX, name));
    assert.ok(st.isFile(), `${name} is a plain file`);
    assert.match(name, /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.(js|css|json|txt)$/);
    assert.ok(st.size <= LIMITS.fileBytes, `${name} is at most 2 MB`);
    total += st.size;
    const text = fs.readFileSync(path.join(ASTRYX, name), 'utf8');
    for (const w of [...FORBIDDEN, 'fonts.css']) assert.ok(!text.includes(w), `${name} holds ${w}`);
    assert.ok(!name.endsWith('.map'));
  }
  assert.ok(total <= LIMITS.totalBytes);
  for (const css of ['reset.css', 'astryx.css', 'theme.css']) {
    assert.ok(!fs.readFileSync(path.join(ASTRYX, css), 'utf8').includes('url('), `${css} holds url(`);
  }
});

test("astryx.lock.json's calls and addresses equal the pinned values", () => {
  const l = lock();
  assert.deepEqual(Object.keys(l.calls).sort(), [...CALL_WORDS].sort());
  assert.deepEqual(l.calls, CALLS);
  assert.deepEqual(l.addresses, ADDRESSES);
  assert.equal(l.astryx, '0.7.16');
  assert.equal(l.react, '19.3.1');
  assert.equal(l.esbuild, '0.28.2');
});

test('the entries export what the plan names', () => {
  const e = lock().exports;
  assert.deepEqual(e['react-dom-client.js'], ['createRoot', 'default', 'hydrateRoot', 'version']);
  assert.deepEqual(e['jsx-runtime.js'], ['Fragment', 'default', 'jsx', 'jsxs']);
  assert.deepEqual(e['theme-neutral.js'], ['neutralIconRegistry', 'neutralPalettes', 'neutralTheme']);
  const react = e['react.js'].filter((n) => n !== 'default');
  assert.equal(react.length, 44);
  assert.equal(react[0], 'Activity');
  assert.equal(react.at(-1), 'version');
  for (const n of ['createElement', 'useState', 'use']) assert.ok(react.includes(n));
  assert.equal(e['react-dom.js'].filter((n) => n !== 'default').length, 15);
  for (const n of ['Button', 'Card', 'Stack', 'Heading', 'Text', 'TabList']) assert.ok(e['core.js'].includes(n));
});

test('tokens.json has 114 colours and the three faces', () => {
  const t = JSON.parse(fs.readFileSync(path.join(KIT, 'tokens.json'), 'utf8'));
  assert.equal(t.version, 1);
  assert.equal(t.colour.length, 114);
  assert.deepEqual(t.face, ['--font-family-body', '--font-family-heading', '--font-family-code']);
  for (const c of t.colour) {
    assert.match(c.name, /^--color-/);
    assert.ok(!c.light.startsWith('light-dark('));
  }
  for (const s of t.size) assert.match(s.name, /^--font-size-|^--text-.+-size$/);
  assert.ok(t.radius.length > 0 && t.shadow.length > 0);
});

test('a link inside a vendor package is refused', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'astryx-vendor-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = path.join(root, '@astryxdesign', 'core');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: '@astryxdesign/core', version: '0.7.16', license: 'MIT' }),
  );
  fs.symlinkSync('/etc/hosts', path.join(pkg, 'hosts'));
  assert.throws(() => readInputs(root), { message: '@astryxdesign/core: hosts is not a plain file' });
  fs.rmSync(path.join(pkg, 'hosts'));
  fs.mkdirSync(path.join(pkg, 'node_modules'));
  assert.throws(() => readInputs(root), { message: '@astryxdesign/core: node_modules is not a plain file' });
});

test('anything else prints usage and exits 2', async () => {
  for (const args of [[], ['--bogus'], ['--check'], ['--verify', 'x'], ['--write', '--vendor']]) {
    const r = await run(args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.stderr, /^usage: /);
  }
});

const haveVendor = fs.existsSync(VENDOR) && fs.existsSync(ESBUILD);
const skipReason = haveVendor ? false : 'the vendor folder or the pinned esbuild is not on this Mac';

test('the known vendor files have their known sha256', { skip: skipReason }, () => {
  const known = {
    '@astryxdesign/core/dist/astryx.css': 'bd7d9f8657ca0f48638163f2df626c9ca3f4cd73b7cb2ba061f2bfb806044638',
    '@astryxdesign/core/src/reset.css': '83b02da1fd4b88c734522f2358aa8cefe1ab1b6e35c9621553e8ab9a933a5a5a',
    '@astryxdesign/theme-neutral/dist/theme.css': '00be60dd79d06150207997ac08c55d280a5891ac812fbc9ebe8eeee491d946c8',
    'react/cjs/react.production.js': '0b5529981841afa1b58c76ba85c29bb681ff5f07cd8cde6a10b967d3915b8e1c',
    'react-dom/cjs/react-dom-client.production.js': 'a319b413b7a19ee34422d9a12a8e7afd003c07846716d278ba1a0898e8cb6251',
  };
  for (const [rel, want] of Object.entries(known)) {
    assert.equal(sha256(fs.readFileSync(path.join(VENDOR, rel))), want, rel);
  }
  // The three stylesheets are copied unchanged.
  assert.equal(sha256(fs.readFileSync(path.join(ASTRYX, 'astryx.css'))), known['@astryxdesign/core/dist/astryx.css']);
  assert.equal(sha256(fs.readFileSync(path.join(ASTRYX, 'reset.css'))), known['@astryxdesign/core/src/reset.css']);
  assert.equal(sha256(fs.readFileSync(path.join(ASTRYX, 'theme.css'))), known['@astryxdesign/theme-neutral/dist/theme.css']);
});

test('--check passes: the build from the vendor folder matches the committed kit', { skip: skipReason }, async (t) => {
  // A temp folder at another depth than the default, so a build that depends on where it ran would fail here.
  const deep = fs.mkdtempSync(path.join(os.tmpdir(), 'astryx-kit-deep-'));
  t.after(() => fs.rmSync(deep, { recursive: true, force: true }));
  const nested = path.join(deep, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  const r = await run(['--check', '--vendor', VENDOR], { TMPDIR: nested });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, 'Astryx kit: the build matches.\n');
});
