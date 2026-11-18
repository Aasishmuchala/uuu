#!/usr/bin/env node
// Builds the Astryx kit (engine/astryx-kit/astryx/) from the vendor folder, with the pinned esbuild.
//
//   node engine/astryx-kit/build.mjs --write --vendor <dir>   check the inputs, build, replace astryx/ and the JSON files
//   node engine/astryx-kit/build.mjs --check --vendor <dir>   check the inputs, build, compare with what is committed
//   node engine/astryx-kit/build.mjs --verify                 every file in astryx/ is as astryx.lock.json lists it
//
// The vendor folder is untrusted data: it is read and hashed, and esbuild parses it. Nothing in it is imported,
// required or run. No dependency; Node 24.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.dirname(KIT_DIR);
const OUT_NAME = 'astryx';
const ESBUILD = path.join(ENGINE_DIR, 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild');
const ESBUILD_VERSION = '0.28.2';

// The twelve inputs (the plan says thirteen; it lists twelve), in LICENSES.txt order. A null version is taken as found and pinned by inputs.lock.json.
export const PACKAGES = [
  { name: '@astryxdesign/core', version: '0.7.16' },
  { name: '@astryxdesign/theme-neutral', version: '0.7.16' },
  { name: 'react', version: '19.3.1' },
  { name: 'react-dom', version: '19.3.1' },
  { name: 'scheduler', version: '0.28.0' },
  { name: '@stylexjs/stylex', version: '0.19.2' },
  { name: 'styleq', version: '0.2.1' },
  { name: 'intl-messageformat', version: '11.2.15' },
  { name: '@formatjs/fast-memoize', version: null },
  { name: '@formatjs/icu-messageformat-parser', version: null },
  { name: '@formatjs/icu-skeleton-parser', version: null },
  { name: 'lucide-react', version: '1.75.0' },
];

const NO_LICENCE_FILE_SOURCE = '@astryxdesign/theme-neutral';
const NO_LICENCE_FILE_NOTE =
  "This package ships no licence file; its package.json says MIT and it is Meta's, as the package above.";

export const IMPORTMAP_TEXT = `${JSON.stringify(
  {
    imports: {
      react: './astryx/react.js',
      'react/jsx-runtime': './astryx/jsx-runtime.js',
      'react-dom': './astryx/react-dom.js',
      'react-dom/client': './astryx/react-dom-client.js',
      '@astryxdesign/core': './astryx/core.js',
      '@astryxdesign/theme-neutral': './astryx/theme-neutral.js',
    },
  },
  null,
  2,
)}\n`;

// The four React entries: [out file, package specifier, production CommonJS file whose exports name them].
const REACT_ENTRIES = [
  ['react.js', 'react', 'react/cjs/react.production.js'],
  ['react-dom.js', 'react-dom', 'react-dom/cjs/react-dom.production.js'],
  ['react-dom-client.js', 'react-dom/client', 'react-dom/cjs/react-dom-client.production.js'],
  ['jsx-runtime.js', 'react/jsx-runtime', 'react/cjs/react-jsx-runtime.production.js'],
];
const ENTRY_NAMES = ['react.js', 'react-dom.js', 'react-dom-client.js', 'jsx-runtime.js', 'core.js', 'theme-neutral.js'];

const STYLESHEETS = [
  ['reset.css', '@astryxdesign/core/src/reset.css'],
  ['astryx.css', '@astryxdesign/core/dist/astryx.css'],
  ['theme.css', '@astryxdesign/theme-neutral/dist/theme.css'],
];

export const LIMITS = { files: 80, fileBytes: 2 * 1024 * 1024, totalBytes: 4 * 1024 * 1024 };
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const EXT_RE = /\.(js|css|json|txt)$/;
export const FORBIDDEN = ['googleapis', 'gstatic', 'esm.sh', 'jsdelivr', 'unpkg', '@import'];
export const CALL_WORDS = [
  'fetch(',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
  'importScripts',
  'new Worker',
  'SharedWorker',
  'serviceWorker',
  'eval(',
  'new Function',
];
const ADDRESS_RE = /https?:\/\/[^\s"'`)<>\\]+/g;
export const CORE_MUST_EXPORT = [
  'Button', 'Card', 'Stack', 'HStack', 'VStack', 'Grid', 'Heading', 'Text', 'Link', 'Section',
  'Divider', 'Badge', 'Icon', 'Dialog', 'TextInput', 'Table', 'TabList',
];

class Refusal extends Error {}
const refuse = (msg) => {
  throw new Refusal(msg);
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

// ---------- inputs ----------

function lstatPlainDir(p, label) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    refuse(`${label} is not there`);
  }
  if (!st.isDirectory()) refuse(`${label} is not a plain folder`);
}

function readPlainFile(pkgName, pkgDir, rel) {
  const p = path.join(pkgDir, rel);
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    refuse(`${pkgName}: ${rel} is not there`);
  }
  if (!st.isFile()) refuse(`${pkgName}: ${rel} is not a plain file`);
  return fs.readFileSync(p);
}

// Every file under a package, sorted by path as bytes. Links, devices and nested node_modules are refused.
function listPackageFiles(pkgName, pkgDir) {
  const out = [];
  const walk = (rel) => {
    const abs = rel ? path.join(pkgDir, rel) : pkgDir;
    for (const name of fs.readdirSync(abs)) {
      const childRel = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(path.join(abs, name));
      if (st.isDirectory()) {
        if (name === 'node_modules') refuse(`${pkgName}: ${childRel} is not a plain file`);
        walk(childRel);
      } else if (st.isFile()) {
        out.push(childRel);
      } else {
        refuse(`${pkgName}: ${childRel} is not a plain file`);
      }
    }
  };
  walk('');
  return out.sort(byBytes);
}

function treeHash(pkgName, pkgDir) {
  const lines = listPackageFiles(pkgName, pkgDir).map(
    (rel) => `${sha256(readPlainFile(pkgName, pkgDir, rel))}  ${rel}\n`,
  );
  return sha256(Buffer.from(lines.join(''), 'utf8'));
}

// Copies a package into dstDir file by file (lstat first, as treeHash) and returns the tree hash of what was copied.
// The build reads only these copies: the bytes esbuild sees are the bytes that were hashed, and the copies sit at the
// same place relative to the working folder in every build (esbuild's chunk hashes include the relative path of each
// module, so building straight from the vendor folder gave other chunk names from a temp folder at another depth).
function copyPackage(pkgName, pkgDir, dstDir) {
  const lines = [];
  for (const rel of listPackageFiles(pkgName, pkgDir)) {
    const buf = readPlainFile(pkgName, pkgDir, rel);
    const dst = path.join(dstDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, buf, { flag: 'wx' });
    lines.push(`${sha256(buf)}  ${rel}\n`);
  }
  return sha256(Buffer.from(lines.join(''), 'utf8'));
}

function findLicenceFile(pkgDir) {
  const names = fs
    .readdirSync(pkgDir)
    .filter((n) => /^licen[cs]e(\.(md|txt))?$/i.test(n))
    .sort(byBytes);
  for (const n of names) if (fs.lstatSync(path.join(pkgDir, n)).isFile()) return n;
  return null;
}

export function readInputs(vendor) {
  lstatPlainDir(vendor, 'the vendor folder');
  const vendorReal = fs.realpathSync(vendor);
  const packages = [];
  const licenceTexts = new Map();
  for (const want of PACKAGES) {
    const pkgDir = path.join(vendorReal, ...want.name.split('/'));
    if (want.name.includes('/')) lstatPlainDir(path.dirname(pkgDir), `${want.name}'s scope folder`);
    lstatPlainDir(pkgDir, want.name);
    let meta;
    try {
      meta = JSON.parse(readPlainFile(want.name, pkgDir, 'package.json').toString('utf8'));
    } catch (e) {
      if (e instanceof Refusal) throw e;
      refuse(`${want.name}: package.json is not JSON`);
    }
    if (meta.name !== want.name) refuse(`${want.name}: package.json names ${String(meta.name).slice(0, 80)}`);
    if (typeof meta.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(meta.version)) {
      refuse(`${want.name}: package.json has no plain version`);
    }
    if (want.version && meta.version !== want.version) {
      refuse(`${want.name}: version ${meta.version}, wanted ${want.version}`);
    }
    const licence = typeof meta.license === 'string' ? meta.license : '';
    if (!/^[A-Za-z0-9.-]{1,40}$/.test(licence)) refuse(`${want.name}: package.json has no plain licence id`);
    const tree = treeHash(want.name, pkgDir);
    const lf = findLicenceFile(pkgDir);
    licenceTexts.set(want.name, lf ? readPlainFile(want.name, pkgDir, lf).toString('utf8') : null);
    packages.push({ name: want.name, version: meta.version, licence, tree });
  }
  return { vendor: vendorReal, lock: { version: 1, packages }, licenceTexts };
}

function compareInputs(found, committedText) {
  let committed;
  try {
    committed = JSON.parse(committedText);
  } catch {
    refuse('inputs.lock.json is missing or not JSON');
  }
  const byName = new Map((committed.packages || []).map((p) => [p.name, p]));
  for (const p of found.packages) {
    const c = byName.get(p.name);
    if (!c || c.version !== p.version || c.tree !== p.tree) {
      refuse(`the vendor folder is not the one this kit was built from: ${p.name}`);
    }
  }
}

// ---------- build ----------

export function cjsExportNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/^exports\.(\w+)/gm)) names.add(m[1]);
  return [...names].sort(byBytes);
}

function runFile(file, args, opts) {
  return new Promise((resolve) => {
    execFile(file, args, { ...opts, shell: false, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function checkEsbuild() {
  let st;
  try {
    st = fs.lstatSync(ESBUILD);
  } catch {
    refuse(`esbuild ${ESBUILD_VERSION} is not in engine/node_modules`);
  }
  if (!st.isFile()) refuse(`esbuild ${ESBUILD_VERSION} is not in engine/node_modules`);
  const r = await runFile(ESBUILD, ['--version'], { env: { PATH: '/usr/bin:/bin' }, timeout: 20000 });
  if (r.err || r.stdout.trim() !== ESBUILD_VERSION) refuse(`esbuild ${ESBUILD_VERSION} is not in engine/node_modules`);
}

function finalExportNames(text) {
  const all = [...text.matchAll(/export\s*\{([^}]*)\}/g)];
  if (all.length === 0) return [];
  const body = all[all.length - 1][1];
  const names = new Set();
  for (const part of body.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/\bas\s+([\w$]+)$/);
    names.add(m ? m[1] : t);
  }
  return [...names].sort(byBytes);
}

function licencesText(inputs) {
  const parts = [
    'Licences of the packages bundled into this folder. Built from the vendor folder by engine/astryx-kit/build.mjs.\n',
  ];
  const fallback = inputs.licenceTexts.get(NO_LICENCE_FILE_SOURCE);
  if (!fallback) refuse(`${NO_LICENCE_FILE_SOURCE}: no licence file`);
  for (const p of inputs.lock.packages) {
    const text = inputs.licenceTexts.get(p.name);
    parts.push(`\n==== ${p.name} ${p.version} (${p.licence}) ====\n\n`);
    if (text) {
      parts.push(text.endsWith('\n') ? text : `${text}\n`);
    } else {
      parts.push(fallback.endsWith('\n') ? fallback : `${fallback}\n`);
      parts.push(`\n${NO_LICENCE_FILE_NOTE}\n`);
    }
  }
  return parts.join('');
}

// tokens.json, read from the text of theme.css with patterns only. The first declaration of a name wins.
export function tokensFromTheme(css) {
  const seen = new Map();
  for (const m of css.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;{}]*);/g)) {
    if (!seen.has(m[1])) seen.set(m[1], m[2].trim());
  }
  const firstArg = (v) => {
    const lm = v.match(/^light-dark\((.*)\)$/s);
    if (!lm) return v;
    let depth = 0;
    const s = lm[1];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      else if (s[i] === ',' && depth === 0) return s.slice(0, i).trim();
    }
    return s.trim();
  };
  const sorted = (arr) => arr.sort((a, b) => byBytes(a.name, b.name));
  const colour = [];
  const size = [];
  const radius = [];
  const shadow = [];
  for (const [name, value] of seen) {
    if (name.startsWith('--color-')) colour.push({ name, light: firstArg(value) });
    else if (name.startsWith('--font-size-') || /^--text-.+-size$/.test(name)) size.push({ name, value });
    else if (name.startsWith('--radius-')) radius.push({ name, value });
    else if (name.startsWith('--shadow-')) shadow.push({ name, value });
  }
  const face = ['--font-family-body', '--font-family-heading', '--font-family-code'];
  for (const f of face) if (!seen.has(f)) refuse(`theme.css does not set ${f}`);
  return {
    version: 1,
    colour: sorted(colour),
    size: sorted(size),
    face,
    radius: sorted(radius),
    shadow: sorted(shadow),
  };
}

function countOf(text, word) {
  let n = 0;
  let i = text.indexOf(word);
  while (i !== -1) {
    n++;
    i = text.indexOf(word, i + word.length);
  }
  return n;
}

// Builds into a new temp folder. Returns { dir (the built astryx/), files: Map name→Buffer, json: {name→text}, cleanup }.
export async function build(inputs) {
  await checkEsbuild();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'astryx-kit-'));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const src = path.join(tmp, 'src');
    fs.mkdirSync(src);
    const modules = path.join(tmp, 'node_modules');
    for (const p of inputs.lock.packages) {
      const tree = copyPackage(p.name, path.join(inputs.vendor, ...p.name.split('/')), path.join(modules, ...p.name.split('/')));
      if (tree !== p.tree) refuse(`the vendor folder changed while the kit was built: ${p.name}`);
    }
    // Licence texts are read again from the copies, so every byte in the kit comes from the hashed tree.
    const copied = { ...inputs, licenceTexts: new Map() };
    for (const p of inputs.lock.packages) {
      const dir = path.join(modules, ...p.name.split('/'));
      const lf = findLicenceFile(dir);
      copied.licenceTexts.set(p.name, lf ? readPlainFile(p.name, dir, lf).toString('utf8') : null);
    }
    const pkgPath = (spec) => path.join(modules, ...spec.split('/'));
    for (const [file, spec, cjs] of REACT_ENTRIES) {
      const pkgName = cjs.split('/')[0];
      const rel = cjs.split('/').slice(1).join('/');
      const names = cjsExportNames(readPlainFile(pkgName, pkgPath(pkgName), rel).toString('utf8'));
      if (names.length === 0) refuse(`${cjs} names no exports`);
      for (const n of names) if (!/^[A-Za-z_$][\w$]*$/.test(n) || n === 'default') refuse(`${cjs}: odd export ${n}`);
      fs.writeFileSync(
        path.join(src, file),
        `import R from '${spec}';\nexport default R;\nexport const { ${names.join(', ')} } = R;\n`,
      );
    }
    fs.writeFileSync(path.join(src, 'core.js'), "export * from '@astryxdesign/core';\n");
    fs.writeFileSync(path.join(src, 'theme-neutral.js'), "export * from '@astryxdesign/theme-neutral';\n");

    const args = [
      ...ENTRY_NAMES.map((n) => `src/${n}`),
      '--bundle',
      '--splitting',
      '--format=esm',
      '--outdir=out',
      '--minify',
      '--target=es2022',
      '--define:process.env.NODE_ENV="production"',
      '--legal-comments=none',
      '--chunk-names=chunk-[hash]',
      '--log-level=warning',
    ];
    const r = await runFile(ESBUILD, args, {
      cwd: tmp,
      env: { NODE_PATH: modules, PATH: '/usr/bin:/bin' },
      timeout: 120000,
    });
    if (r.err || r.stderr.length > 0) {
      const first = (r.stderr || String(r.err && r.err.message) || '').split('\n').filter(Boolean).slice(0, 5);
      refuse(`esbuild failed:\n${first.join('\n')}`);
    }

    const outDir = path.join(tmp, 'out');
    const files = new Map();
    for (const name of fs.readdirSync(outDir).sort(byBytes)) {
      const st = fs.lstatSync(path.join(outDir, name));
      if (!st.isFile()) refuse(`esbuild wrote ${name.slice(0, 80)}, which is not a plain file`);
      files.set(name, fs.readFileSync(path.join(outDir, name)));
    }
    for (const n of ENTRY_NAMES) if (!files.has(n)) refuse(`esbuild did not write ${n}`);
    for (const [name, rel] of STYLESHEETS) {
      const [a, b, ...rest] = rel.split('/');
      const pkg = `${a}/${b}`;
      files.set(name, readPlainFile(pkg, pkgPath(pkg), rest.join('/')));
    }
    files.set('importmap.json', Buffer.from(IMPORTMAP_TEXT, 'utf8'));
    files.set('LICENSES.txt', Buffer.from(licencesText(copied), 'utf8'));

    // Limits.
    if (files.size > LIMITS.files) refuse(`the kit has ${files.size} files; at most ${LIMITS.files}`);
    let total = 0;
    for (const [name, buf] of files) {
      if (!NAME_RE.test(name) || !EXT_RE.test(name)) refuse(`the kit may not hold a file named ${name.slice(0, 80)}`);
      if (buf.length > LIMITS.fileBytes) refuse(`${name} is ${buf.length} bytes; at most ${LIMITS.fileBytes}`);
      total += buf.length;
    }
    if (total > LIMITS.totalBytes) refuse(`the kit is ${total} bytes; at most ${LIMITS.totalBytes}`);

    // Scans.
    for (const [name, buf] of files) {
      const text = buf.toString('utf8');
      for (const w of FORBIDDEN) if (text.includes(w)) refuse(`${name} holds ${w}`);
    }
    for (const [name] of STYLESHEETS) {
      if (files.get(name).toString('utf8').includes('url(')) refuse(`${name} holds url(`);
    }
    const addresses = new Set();
    const calls = Object.fromEntries(CALL_WORDS.map((w) => [w, 0]));
    for (const [name, buf] of [...files].sort((a, b) => byBytes(a[0], b[0]))) {
      if (!/\.(js|css)$/.test(name)) continue;
      const text = buf.toString('utf8');
      for (const m of text.matchAll(ADDRESS_RE)) addresses.add(m[0]);
      for (const w of CALL_WORDS) calls[w] += countOf(text, w);
    }
    const exportsMap = {};
    for (const n of ['core.js', 'theme-neutral.js', 'react.js', 'react-dom.js', 'react-dom-client.js', 'jsx-runtime.js']) {
      exportsMap[n] = finalExportNames(files.get(n).toString('utf8'));
    }
    const missing = CORE_MUST_EXPORT.filter((n) => !exportsMap['core.js'].includes(n));
    if (missing.length) refuse(`core.js does not export ${missing.join(', ')}`);

    const lock = {
      version: 1,
      astryx: '0.7.16',
      react: '19.3.1',
      esbuild: ESBUILD_VERSION,
      files: [...files]
        .sort((a, b) => byBytes(a[0], b[0]))
        .map(([name, buf]) => ({ name, bytes: buf.length, sha256: sha256(buf) })),
      exports: exportsMap,
      addresses: [...addresses].sort(byBytes),
      calls,
    };
    const tokens = tokensFromTheme(files.get('theme.css').toString('utf8'));

    const kitDir = path.join(tmp, OUT_NAME);
    fs.mkdirSync(kitDir);
    for (const [name, buf] of files) fs.writeFileSync(path.join(kitDir, name), buf);
    return {
      dir: kitDir,
      files,
      json: {
        'astryx.lock.json': jsonText(lock),
        'inputs.lock.json': jsonText(inputs.lock),
        'tokens.json': jsonText(tokens),
      },
      cleanup,
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}

// ---------- verify ----------

export function verify(kitRoot = KIT_DIR) {
  const problems = [];
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(path.join(kitRoot, 'astryx.lock.json'), 'utf8'));
  } catch {
    return { ok: false, problems: ['astryx.lock.json: missing or not JSON'] };
  }
  const listed = new Map((Array.isArray(lock.files) ? lock.files : []).map((f) => [f.name, f]));
  const dir = path.join(kitRoot, OUT_NAME);
  let names = [];
  try {
    const st = fs.lstatSync(dir);
    if (!st.isDirectory()) return { ok: false, problems: [`${OUT_NAME}/: not a plain folder`] };
    names = fs.readdirSync(dir).sort(byBytes);
  } catch {
    return { ok: false, problems: [`${OUT_NAME}/: missing`] };
  }
  let total = 0;
  const present = new Set();
  for (const name of names) {
    const shown = name.slice(0, 80);
    const st = fs.lstatSync(path.join(dir, name));
    if (!st.isFile()) {
      problems.push(`${shown}: not a plain file`);
      continue;
    }
    present.add(name);
    const want = listed.get(name);
    if (!want) {
      problems.push(`${shown}: not in astryx.lock.json`);
      continue;
    }
    if (st.size !== want.bytes) {
      problems.push(`${shown}: ${st.size} bytes, listed ${want.bytes}`);
      continue;
    }
    if (sha256(fs.readFileSync(path.join(dir, name))) !== want.sha256) {
      problems.push(`${shown}: sha256 differs from the list`);
      continue;
    }
    total += st.size;
  }
  for (const name of listed.keys()) if (!present.has(name)) problems.push(`${name}: listed but missing`);
  return { ok: problems.length === 0, problems, count: present.size, bytes: total };
}

// ---------- modes ----------

function compareWithCommitted(built) {
  const diffs = [];
  const dir = path.join(KIT_DIR, OUT_NAME);
  let committed = [];
  try {
    committed = fs.readdirSync(dir);
  } catch {
    diffs.push(`${OUT_NAME}/: missing`);
  }
  const all = new Set([...committed, ...built.files.keys()]);
  for (const name of [...all].sort(byBytes)) {
    const b = built.files.get(name);
    let c = null;
    try {
      if (fs.lstatSync(path.join(dir, name)).isFile()) c = fs.readFileSync(path.join(dir, name));
    } catch {}
    if (!b) diffs.push(`${OUT_NAME}/${name.slice(0, 80)}: not made by the build`);
    else if (!c) diffs.push(`${OUT_NAME}/${name}: made by the build, not committed`);
    else if (!b.equals(c)) diffs.push(`${OUT_NAME}/${name}: differs`);
  }
  for (const [name, text] of Object.entries(built.json)) {
    let c = null;
    try {
      c = fs.readFileSync(path.join(KIT_DIR, name), 'utf8');
    } catch {}
    if (c !== text) diffs.push(`${name}: differs`);
  }
  return diffs;
}

function writeBuilt(built) {
  const target = path.join(KIT_DIR, OUT_NAME);
  const fresh = path.join(KIT_DIR, `.${OUT_NAME}.new`);
  fs.rmSync(fresh, { recursive: true, force: true });
  fs.mkdirSync(fresh);
  for (const [name, buf] of built.files) fs.writeFileSync(path.join(fresh, name), buf);
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(fresh, target);
  for (const [name, text] of Object.entries(built.json)) fs.writeFileSync(path.join(KIT_DIR, name), text);
}

const USAGE = `usage: build.mjs --write --vendor <dir> | --check --vendor <dir> | --verify\n`;

async function main(argv) {
  const [mode, ...rest] = argv;
  if (mode === '--verify' && rest.length === 0) {
    const r = verify();
    if (r.ok) {
      process.stdout.write(`Astryx kit: ${r.count} files, ${r.bytes} bytes, as listed.\n`);
      return 0;
    }
    process.stdout.write(r.problems.map((l) => `${l}\n`).join(''));
    return 1;
  }
  if ((mode === '--write' || mode === '--check') && rest.length === 2 && rest[0] === '--vendor' && rest[1]) {
    const vendor = path.resolve(rest[1]);
    const inputs = readInputs(vendor);
    if (mode === '--check') {
      let committedInputs = '';
      try {
        committedInputs = fs.readFileSync(path.join(KIT_DIR, 'inputs.lock.json'), 'utf8');
      } catch {}
      compareInputs(inputs.lock, committedInputs);
    }
    const built = await build(inputs);
    try {
      if (mode === '--write') {
        writeBuilt(built);
        process.stdout.write(`Astryx kit: wrote ${built.files.size} files.\n`);
        return 0;
      }
      const diffs = compareWithCommitted(built);
      if (diffs.length === 0) {
        process.stdout.write('Astryx kit: the build matches.\n');
        return 0;
      }
      process.stdout.write(diffs.map((l) => `${l}\n`).join(''));
      return 1;
    } finally {
      built.cleanup();
    }
  }
  process.stderr.write(USAGE);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      if (e instanceof Refusal) {
        process.stdout.write(`${e.message}\n`);
        process.exitCode = 1;
      } else {
        process.stderr.write(`${e && e.stack ? e.stack : e}\n`);
        process.exitCode = 1;
      }
    },
  );
}
