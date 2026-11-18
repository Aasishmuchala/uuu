// The Builder's Astryx block (PLAN-ASTRYX T9, D12): one marked block in builder.md, nothing else changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const rolesDir = join(here, "..", "roles");
const builder = readFileSync(join(rolesDir, "builder.md"), "utf8");
const START = "<!-- astryx:start -->";
const END = "<!-- astryx:end -->";
const count = (text, s) => text.split(s).length - 1;

function block() {
  const a = builder.indexOf(START);
  const b = builder.indexOf(END);
  return builder.slice(a, b + END.length);
}

test("the two markers each appear once, start before end", () => {
  assert.equal(count(builder, START), 1);
  assert.equal(count(builder, END), 1);
  assert.ok(builder.indexOf(START) < builder.indexOf(END));
});

test("the block sits below Pages and above Rounds, the cook way, with a blank line each side", () => {
  const pages = builder.indexOf("### Pages");
  const rounds = builder.indexOf("### Rounds, the cook way");
  assert.ok(pages >= 0 && rounds >= 0);
  assert.equal(count(builder, "### Rounds, the cook way"), 1);
  assert.ok(pages < builder.indexOf(START));
  assert.ok(builder.indexOf(END) < rounds);
  assert.ok(builder.includes("\n\n" + START + "\n"));
  assert.ok(builder.includes(END + "\n\n### Rounds, the cook way"));
});

test("the block holds the words the plan fixes", () => {
  const b = block();
  for (const s of [
    "$UUU_PLAYBOOKS_DIR/astryx-kit/",
    'cp -R "$UUU_PLAYBOOKS_DIR/astryx-kit/astryx" site/<name>/astryx',
    "brand/astryx-theme.css",
    "<main data-astryx-root>",
    "h(Component, props, ...children)",
    "COMPONENTS.md",
    "kit_file_changed",
    "drawn_late",
    "The Astryx kit is not installed.",
    "never mix the two",
  ]) assert.ok(b.includes(s), s);
});

test("with the block cut out, the file is build/v5-cook's, byte for byte", (t) => {
  let base;
  try {
    base = execFileSync("git", ["show", "build/v5-cook:engine/company/roles/builder.md"],
      { cwd: here, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 4 * 1024 * 1024 });
  } catch {
    t.skip("the ref build/v5-cook is not in this repository");
    return;
  }
  const cut = builder.replace(block() + "\n\n", "");
  assert.equal(cut, base);
});

test("no other role file names astryx", () => {
  for (const f of readdirSync(rolesDir)) {
    if (f === "builder.md" || !f.endsWith(".md")) continue;
    assert.ok(!/astryx/i.test(readFileSync(join(rolesDir, f), "utf8")), f);
  }
});
