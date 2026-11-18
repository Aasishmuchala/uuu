// PLAN-ASTRYX T10: the home server's judge of drawn pages (lib/sitebrand.mjs, judgePage) passes an Astryx site.
// The site is put together as the Builder makes it (the example page of engine/astryx-kit/example, the kit's files
// under astryx/, kit.css and astryx-theme.css written by the home server's own functions from the brand kit, a small
// logo), rendered by the page viewer's own code with the REAL Chrome on port 0, read back the way the home server
// keeps it (siteshots.mjs, readShotsTar), and judged against the kit in the shape measuredKit reads it from a saved
// kit.json. Two kits: Kit A allows greys, Kit B refuses them. Then a second site that draws more of Astryx's parts
// (a badge, a table, a text box, tabs, a divider, a link, text of every type and a closed dialog), judged the same
// way. Expected for every page: no fail line (colours, faces, sizes, addresses) and nothing "unknown".
// Skipped, saying why, when Chrome is not installed. Nothing reaches the internet: every port is 0 and the viewer's
// own proxy allows only the site. Only processes this file started are ended, by their group id.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mintToken } from "../../../relay/token.mjs";
import { CHROME_PATH, chromeInstalled, defaultLaunch, groupOf, readPs } from "../../../viewer/chrome.mjs";
import { writeTar } from "../../../viewer/tar.mjs";
import { createViewer } from "../../../viewer/viewer.mjs";
import { astryxThemeCss, checkKit, emptyKit, kitCss, loadAstryxTokens } from "../brain/kit.mjs";
import { judgePage, measuredKit } from "../lib/sitebrand.mjs";
import { readShotsTar } from "../lib/siteshots.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, "..", "..", "..", "astryx-kit");
const SECRET = "7".repeat(64);
const HAVE = chromeInstalled(CHROME_PATH);
const skip = HAVE ? false : `Chrome is not installed at ${CHROME_PATH}`;

// Kit A of PLAN-ASTRYX T3 (as the viewer's T8 test has it), with two faces this Mac has; Kit B is the same with
// greys refused.
const ENV = { families: new Set(["Didot", "Avenir Next"]), fonts: new Set(), brandPictures: new Set(), referencePictures: new Set() };
function brandKit(neutrals) {
  const k = emptyKit(["Didot"]);
  k.name = "Harbour";
  k.colours = [
    { name: "ink", hex: "#1A3C5E", role: "main" }, { name: "sun", hex: "#E0A100", role: "accent" },
    { name: "paper", hex: "#FAF7F2", role: "background" }, { name: "night", hex: "#0B1D2E", role: "text" },
  ];
  k.type.body = { family: "Avenir Next", file: null, fallback: "sans-serif" };
  k.neutrals = neutrals;
  k.layout.radiusPx = 6;
  k.type.minPx = 16;
  return checkKit(k, ENV);
}
const KITS = [["Kit A (greys allowed)", true], ["Kit B (greys refused)", false]];

let dir; let paths;
const launched = [];
function launch(program, args, env) {
  const out = defaultLaunch(program, args, env);
  launched.push(out.child.pid);
  return out;
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), "astryx-judge-"));
  mkdirSync(join(dir, "doors"), { mode: 0o700 });
  paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"), viewerSecret: join(dir, "viewer-secret"),
    viewerStatus: join(dir, "doors", "viewer-status.json"), doorWork: join(dir, "doors", "work"),
  };
  writeFileSync(paths.viewerSecret, `${SECRET}\n`);
  chmodSync(paths.viewerSecret, 0o600);
  writeFileSync(paths.ids, JSON.stringify({ agents: {} }));
  chmodSync(paths.ids, 0o644);
});
after(() => {
  for (const g of launched) { try { process.kill(-g, "SIGKILL"); } catch { /* ended already */ } }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// The judge's kit, read by measuredKit from a kit.json saved in a brand folder of this test's own.
function judgeKit(kit, name) {
  const docs = join(dir, `docs-${name}`);
  mkdirSync(join(docs, "brand"), { recursive: true });
  writeFileSync(join(docs, "brand", "kit.json"), `${JSON.stringify(kit, null, 2)}\n`);
  const k = measuredKit({ paths: { knowledgeDocs: docs, state: join(dir, "state") } });
  assert.ok(k, "the judge reads the kit");
  assert.equal(k.neutrals, kit.neutrals);
  assert.equal(k.colours.length, 4);
  assert.deepEqual([...k.families].sort(), ["avenir next", "didot"]);
  return k;
}

// The example Astryx site, file by file; `over` replaces or adds files by name.
function astryxSite(kit, over = []) {
  const tokens = loadAstryxTokens(join(KIT, "tokens.json"));
  const theme = astryxThemeCss(kit, tokens);
  assert.ok(theme, "the brand kit gives an Astryx theme");
  const files = new Map();
  for (const n of readdirSync(join(KIT, "astryx")).sort()) files.set(`astryx/${n}`, readFileSync(join(KIT, "astryx", n)));
  for (const n of readdirSync(join(KIT, "example")).sort()) files.set(n, readFileSync(join(KIT, "example", n)));
  files.set("kit.css", Buffer.from(kitCss(kit)));
  files.set("astryx-theme.css", Buffer.from(theme));
  files.set("logo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" viewBox="0 0 64 32"><rect width="64" height="32" fill="#1A3C5E"/></svg>'));
  for (const f of over) files.set(f.name, f.data);
  return [...files].map(([name, data]) => ({ name, data }));
}

// The second site's page: more of Astryx's parts, written as the Builder writes a page (h(...), no colour, no face,
// no size, no address). Text of every type the component's page lists.
const TEXT_TYPES = ["body", "large", "label", "supporting", "code", "display-1", "display-2", "display-3", "inherit"];
const PARTS_APP = `// More of Astryx's parts, for the judge of drawn pages (PLAN-ASTRYX T10).
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Badge, Dialog, DialogHeader, Divider, Heading, Link, Section, Tab, TabList, Table, Text, TextInput, VStack,
  registerIcons,
} from '@astryxdesign/core';
import { neutralIconRegistry } from '@astryxdesign/theme-neutral';

const h = React.createElement;
registerIcons(neutralIconRegistry);

const rows = [
  { id: 'one', name: 'First row', note: 'The first of two rows.' },
  { id: 'two', name: 'Second row', note: 'The second of two rows.' },
];
const columns = [{ key: 'name', header: 'Name' }, { key: 'note', header: 'Note' }];
const types = ${JSON.stringify(TEXT_TYPES)};

function Parts() {
  const [tab, setTab] = React.useState('first');
  const [words, setWords] = React.useState('');
  const [open, setOpen] = React.useState(false);
  return h(
    Section,
    { variant: 'transparent', paddingBlock: 8, paddingInline: 0 },
    h(
      VStack,
      { gap: 5, hAlign: 'start' },
      h(Heading, { level: 1 }, 'The parts page'),
      h(Badge, { label: 'A badge' }),
      h(TabList, { value: tab, onChange: setTab, hasDivider: true },
        h(Tab, { value: 'first', label: 'First tab' }),
        h(Tab, { value: 'second', label: 'Second tab' })),
      h(Table, { data: rows, columns, idKey: 'id' }),
      h(TextInput, { label: 'Your name', value: words, onChange: setWords, placeholder: 'A name' }),
      h(Divider),
      types.map((t) => h(Text, { key: t, type: t, as: 'p' }, 'Text of the type ' + t + '.')),
      h(Link, { href: 'astryx/LICENSES.txt' }, 'The licences of the kit'),
      h(Dialog, { isOpen: open, onOpenChange: setOpen },
        h(DialogHeader, { title: 'A closed dialog' }),
        h(Text, { as: 'p' }, 'The dialog is closed, so this is not drawn.')),
    ),
  );
}

createRoot(document.querySelector('[data-astryx-root]')).render(h(Parts));
`;

const owner = () => mintToken(SECRET, "t", "owner", Math.floor(Date.now() / 1000) + 600);
// One render through the viewer's door, read back as the home server keeps it. -> { pages, shots }.
async function render(files) {
  const v = createViewer({
    listenPort: 0, paths, config: { doors: { viewer: { agents: ["builder"] } } }, log: () => {},
    chrome: { path: CHROME_PATH, launch },
  });
  const port = await v.listen();
  try {
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/view/shots", agent: false,
        headers: { Authorization: `Bearer ${owner()}`, "Content-Type": "application/x-tar" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, raw: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end(writeTar(files));
    });
    assert.equal(r.status, 200, r.raw.toString().slice(0, 300));
    const kept = readShotsTar(r.raw);
    assert.equal(kept.ok, true, kept.reason);
    return { pages: kept.report.pages, shots: kept.shots.map((s) => s.name).sort() };
  } finally {
    await v.close();
  }
}

// Every page of the render, judged: drawn whole and not one fail or unknown line.
function judged(pages, kit, label) {
  assert.ok(pages.length >= 1, `${label}: no page reported`);
  for (const p of pages) {
    assert.equal(p.cut, null, `${label}: ${p.page} was cut short`);
    assert.deepEqual(p.errors, [], `${label}: ${p.page}: ${p.errors.join(" | ")}`);
    assert.deepEqual(p.blocked, [], `${label}: ${p.page} reached outside the site`);
    assert.ok(p.colours.length > 0 && p.fonts.length > 0, `${label}: ${p.page} measured nothing`);
    const j = judgePage(p, kit);
    assert.deepEqual(j.fail, [], `${label}: ${p.page}: colours ${p.colours.join(", ")}`);
    assert.deepEqual(j.unknown, [], `${label}: ${p.page}`);
  }
}

for (const [label, neutrals] of KITS) {
  test(`the example Astryx site passes the judge of drawn pages: ${label}`, { skip, timeout: 120_000 }, async () => {
    const kit = brandKit(neutrals);
    const k = judgeKit(kit, neutrals ? "a" : "b");
    const { pages, shots } = await render(astryxSite(kit));
    assert.deepEqual(shots, ["shot-index-1280-light.png", "shot-index-390-light.png"]);
    judged(pages, k, label);
    // the theme's ground and accent are drawn: the page is the brand kit's, not Astryx's own neutral one
    assert.ok(pages[0].colours.includes("#FAF7F2") && pages[0].colours.includes("#E0A100"), pages[0].colours.join(", "));
  });

  test(`a page of more Astryx parts passes the judge of drawn pages: ${label}`, { skip, timeout: 120_000 }, async () => {
    const kit = brandKit(neutrals);
    const k = judgeKit(kit, neutrals ? "a2" : "b2");
    const { pages } = await render(astryxSite(kit, [{ name: "app.js", data: Buffer.from(PARTS_APP) }]));
    judged(pages, k, label);
  });
}

// What the judge needed of the theme (T10): Astryx's weights only at the two Chrome names as the kit's family, and a
// <dialog>'s text in the kit's ink rather than the browser's black.
test("the theme draws at regular and bold only, and gives a dialog the kit's text colour", () => {
  for (const neutrals of [true, false]) {
    const text = astryxThemeCss(brandKit(neutrals), loadAstryxTokens(join(KIT, "tokens.json")));
    for (const d of ["--font-weight-normal: 400;", "--font-weight-medium: 400;", "--font-weight-semibold: 700;", "--font-weight-bold: 700;"]) {
      assert.ok(text.includes(`\n  ${d}\n`), d);
    }
    assert.ok(text.includes("\ndialog { color: var(--color-text-primary); }\n"));
  }
});

test("the page's own words for the parts page hold no colour, face, size in px or address", () => {
  assert.doesNotMatch(PARTS_APP, /#[0-9A-Fa-f]{3}\b|#[0-9A-Fa-f]{6}\b|rgb\(|\bpx\b|https?:|fetch\(|style:|xstyle/);
});

test("after every render: no Chrome this file started is left", { skip }, async () => {
  const rows = await readPs();
  for (const g of launched) assert.equal(groupOf(rows, g).members.length, 0, `group ${g} still runs`);
});
