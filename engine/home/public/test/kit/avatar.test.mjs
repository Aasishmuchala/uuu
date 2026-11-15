// The kit's avatar (CONTRACTS-V2 13.1): the initials' vectors, and the stylesheet's rules. Split out of kit-a
// (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, elements, installDom, showTree, textOf } from "./_dom.mjs";
import { css, primitiveSheetTests } from "./_rules.mjs";

const kit = { avatar: await import(pathToFileURL(join(KIT, "avatar.js")).href) };

test("initials: the pinned vectors", () => {
  const { initials } = kit.avatar;
  assert.equal(initials("Chief of staff"), "CS");
  assert.equal(initials("Artist"), "A");
  assert.equal(initials(""), "?");
  assert.equal(initials(undefined), "?");
  assert.equal(initials("sales agent"), "SA");
});

test("an avatar is round with a hairline edge: no ring glow, no spaced initials", () => {
  const s = css("kit/avatar.css");
  const root = /\.k-avatar\s*\{([^}]*)\}/.exec(s)[1];
  assert.match(root, /border-radius: var\(--r-round\);/);
  assert.match(root, /box-shadow: inset 0 0 0 1px var\(--line\);/);
  for (const sh of s.matchAll(/box-shadow:\s*([^;]+);/g)) assert.doesNotMatch(sh[1], /\d+px \d+px [1-9]/, "no blurred shadow");
  assert.doesNotMatch(s, /letter-spacing/);
});

test("no avatar size draws text under 12 px: the small sizes show one initial at 12 px", async () => {
  const s = css("kit/avatar.css");
  for (const n of [20, 24, 32, 40, 48, 72]) {
    const fs = new RegExp(`\\.k-avatar--${n} \\{[^}]*font-size: ([^;]+);`).exec(s);
    assert.ok(fs, `size ${n} sets its type`);
    assert.doesNotMatch(fs[1], /\*/, `size ${n} is not scaled below the label step`);
  }
  assert.match(/\.k-avatar--24 \{[^}]*\}/.exec(s)[0], /font-size: var\(--fs-label\);/, "the small sizes draw at 12 px");
  assert.doesNotMatch(s, /font-size: 0/, "no text is sized away: the measure counts it as type under 12 px");
  installDom();
  for (const size of [20, 24]) assert.equal(textOf(await showTree(kit.avatar.Avatar, { slug: "chief-of-staff", name: "Chief of staff", size })), "C", `${size} px: one initial`);
  assert.equal(textOf(await showTree(kit.avatar.Avatar, { slug: "chief-of-staff", name: "Chief of staff", size: 32 })), "CS", "32 px: both");
  assert.match(css("tokens.css"), /--fw-bold: 600;/);
  assert.match(/\.k-avatar__initials \{([^}]*)\}/.exec(s)[1], /font-weight: var\(--fw-bold\);/, "weight 600");
});

test("the owner's avatar is drawn like the agents': the raised step and ink initials, never the accent", () => {
  const you = /\.k-avatar--you \{([^}]*)\}/.exec(css("kit/avatar.css"));
  assert.ok(you, "the owner's avatar has its rule");
  assert.match(you[1], /background: var\(--raise\);/);
  assert.match(you[1], /color: var\(--ink\);/);
  assert.doesNotMatch(you[1], /accent/, "the accent is the primary's alone");
});

// PLAN-COOK TB4: one avatar style. A flat disc with the glyph or the initials, never a picture, so no page asks the
// server for a file that may not be there (S13c logged a 404 for /assets/avatars/researcher.png).
test("one avatar style: a flat tinted disc with initials or a glyph, and never a picture", async () => {
  installDom();
  const { Avatar, avatarTint } = kit.avatar;
  for (const props of [{ slug: "marketer", name: "Marketer", size: 40 }, { slug: "researcher", name: "Researcher", size: 32 }, { slug: "you", name: "You" }]) {
    const root = await showTree(Avatar, props);
    assert.equal(elements(root).some((e) => e.localName === "img"), false, `${props.slug}: no picture`);
  }
  let root = await showTree(Avatar, { slug: "researcher", name: "Researcher", size: 40 });
  assert.equal(textOf(root), "R");
  assert.match(root.firstChild.getAttribute("class"), new RegExp(`k-avatar--40 k-avatar--tint-${avatarTint("researcher")}`));
  root = await showTree(Avatar, { slug: "marketer", name: "Marketer", size: 24, icon: "horn" });
  assert.ok(elements(root).some((e) => /\bk-icon\b/.test(e.getAttribute("class") || "")), "a glyph when the caller names one");
  assert.equal(textOf(root), "", "the glyph instead of the initials");
  assert.equal(avatarTint("marketer"), avatarTint("marketer"), "the same tint for a slug every time");
  assert.ok(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(avatarTint)).size > 1, "slugs spread over the tints");
  const s = css("kit/avatar.css");
  assert.doesNotMatch(s, /avatar-backing|k-avatar__img|k-avatar--picture/, "no picture styles left");
  for (let n = 1; n <= 6; n++) assert.match(s, new RegExp(`\\.k-avatar--tint-${n} \\{ --k-avatar-hue: [^;]*var\\(--accent-(blue|green|violet|orange|rose)\\)[^;]*; \\}`), `tint ${n} is a hue, never a grey`);
  assert.match(s, /background: color-mix\(in srgb, var\(--k-avatar-hue\) 20%, var\(--raise\)\);/, "a quiet tint");
  assert.doesNotMatch(readFileSync(join(KIT, "avatar.js"), "utf8"), /assets\/avatars|<img/, "the part never names a picture");
});

primitiveSheetTests("avatar");
