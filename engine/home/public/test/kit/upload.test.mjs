// The kit's file picker (CONTRACTS-V3 28). Split out of kit-c (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, elements, textOf, settle, mount, unmount, fire } from "./_dom.mjs";
import { newSheetTest } from "./_rules.mjs";

const kit = { upload: await import(pathToFileURL(join(KIT, "upload.js")).href) };

// ---- FilePicker ----

test("FilePicker refuses by ending and by size before anything is read; a good file is read and handed on", async () => {
  installDom();
  let readers = 0;
  const realReader = globalThis.FileReader;
  globalThis.FileReader = class {
    constructor() { readers++; }
    readAsDataURL() { this.result = "data:text/markdown;base64,SGVsbG8="; setTimeout(() => this.onload(), 0); }
  };
  const { refusePick, endingsOf, FilePicker } = kit.upload;
  try {
    assert.deepEqual(endingsOf(".md, .PNG ,x, .tar.gz"), [".md", ".png"]);
    assert.deepEqual(endingsOf([".md", "javascript:"]), [".md"]);
    assert.match(refusePick({ name: "a.svg", size: 10 }, { accept: [".png"], maxBytes: 100 }), /cannot be added/);
    assert.match(refusePick({ name: ".png", size: 10 }, { accept: [".png"], maxBytes: 100 }), /cannot be added/);
    assert.match(refusePick({ name: "a.png", size: 101 }, { accept: [".png"], maxBytes: 100 }), /too large\. The limit is 100 bytes\./);
    assert.match(refusePick({ name: "a.png", size: 0 }, { accept: [".png"], maxBytes: 100 }), /empty/);
    assert.equal(refusePick({ name: "A.PNG", size: 100 }, { accept: [".png"], maxBytes: 100 }), null);
    assert.match(refusePick(null, {}), /Pick a file/);

    const picks = [];
    const root = await mount(FilePicker, { accept: [".md"], maxBytes: 1000, onPick: (p) => picks.push(p) });
    const input = elements(root).find((e) => e.localName === "input");
    assert.equal(input.getAttribute("type"), "file");
    assert.equal(input.getAttribute("accept"), ".md");
    assert.ok(elements(root).some((e) => e.localName === "label" && e.getAttribute("for") === input.getAttribute("id")), "the area is the input's label");
    fire(input, "change", { target: { files: [{ name: "huge.md", size: 5000 }], value: "x" } });
    await settle();
    assert.match(textOf(root), /That file is too large/);
    fire(input, "change", { target: { files: [{ name: "page.html", size: 10 }], value: "x" } });
    await settle();
    assert.match(textOf(root), /cannot be added here/);
    assert.equal(readers, 0, "nothing was read");
    assert.equal(picks.length, 0);
    fire(input, "change", { target: { files: [{ name: "notes.md", size: 5 }], value: "x" } });
    await settle();
    assert.equal(readers, 1);
    assert.deepEqual(picks, [{ name: "notes.md", base64: "SGVsbG8=", size: 5 }]);
    unmount(root);
  } finally {
    globalThis.FileReader = realReader;
  }
});

newSheetTest("upload");
