// The staging harness itself (PLAN-APPS-ASTRYX T6): each app comes on in the real fence on its
// staging port (4871, 4872) with the stand-ins, answers /healthz and its page through the host
// with the host's policy, the door has seen no job before anything was asked, and after stop()
// nothing listens on the port and the temp root is gone. Skipped, saying why, when Chrome,
// ffmpeg, the sandbox tool or an app's build is missing. Nothing here writes the live state,
// reaches the internet, or opens a port but the staging ones and port 0.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { contentPolicy } from "../../host.mjs";
import { CHROME_PATH, chromeInstalled } from "../../../viewer/chrome.mjs";
import { makePictures } from "./pictures.mjs";
import { forbiddenPort, missingFor, portBusy, request, rewriteOneLine, STAGE_PORTS, startStage } from "./stage.mjs";

const SLUGS = Object.keys(STAGE_PORTS);
const scratch = mkdtempSync("/private/tmp/uuu-stage-test-");
after(() => rmSync(scratch, { recursive: true, force: true }));

function skipFor(slug) {
  if (!chromeInstalled(CHROME_PATH)) return `Chrome is not installed at ${CHROME_PATH}`;
  const missing = missingFor(slug);
  return missing.length ? `missing on this Mac: ${missing.join(", ")}` : false;
}

test("the harness refuses the forbidden ports and any port outside 4871-4889", async () => {
  for (const p of [3100, 3171, 3172, 3200, 3299, 5000, 5432, 7000, 8120]) assert.ok(forbiddenPort(p), String(p));
  for (const p of [4871, 4872, 4889]) assert.ok(!forbiddenPort(p), String(p));
  await assert.rejects(startStage({ slug: "render-to-film", port: 3171 }), /not one this harness may use/);
  await assert.rejects(startStage({ slug: "arch-film-studio", port: 4890 }), /outside 4871-4889/);
  await assert.rejects(startStage({ slug: "nothing", port: 4871 }), /no app is named/);
});

test("a rewrite that does not change exactly one line fails loudly", async () => {
  const { writeFileSync, readFileSync } = await import("node:fs");
  const f = join(scratch, "two.txt");
  writeFileSync(f, "a = 3171\nb = 3171\n");
  assert.throws(() => rewriteOneLine(f, /3171/, "4871"), /exactly one line/);
  writeFileSync(f, "a = 3171\nb = 1\n");
  rewriteOneLine(f, /3171/, "4871");
  assert.equal(readFileSync(f, "utf8"), "a = 4871\nb = 1\n");
});

let pictures = null;
for (const slug of SLUGS) {
  const port = STAGE_PORTS[slug];
  const skip = skipFor(slug);
  test(`${slug} comes on in the fence on ${port}, answers through the host with its policy, and stop() leaves nothing`, { skip, timeout: 300_000 }, async () => {
    assert.equal(await portBusy(port), false, `port ${port} is busy before the test`);
    pictures ??= await makePictures({ into: join(scratch, "pictures"), limit: 1 });
    const stage = await startStage({ slug, port, pictures });
    let stopped = false;
    try {
      assert.equal(stage.url, `http://127.0.0.1:${port}`);
      assert.ok(stage.root.startsWith("/private/tmp/uuu-stage-"));
      assert.ok(stage.dataDir.startsWith(stage.root + "/"));
      const h = await request({ port, path: "/healthz" });
      assert.equal(h.status, 200);
      assert.equal(h.body.toString(), "ok");
      const page = await request({ port, path: "/", headers: { Accept: "text/html" } });
      assert.equal(page.status, 200);
      assert.match(page.body.toString(), /<div id="root">/);
      assert.equal(page.headers["content-security-policy"], contentPolicy(stage.cfg.ports.home));
      assert.equal(page.headers["x-content-type-options"], "nosniff");
      // The page asks its own server for the allowance; the door answers, but no job was made.
      assert.equal(stage.door.jobPosts().length, 0, "the door saw a job before any click");
      assert.equal(stage.door.state.jobs.size, 0);
      for (const c of stage.door.calls) assert.equal(c.who?.app, slug);
      await stage.stop();
      stopped = true;
      assert.equal(existsSync(stage.root), false, "the temp root is gone");
      assert.equal(await portBusy(port), false, `something still listens on ${port}`);
    } finally {
      if (!stopped) await stage.stop();
    }
  });
}

test("nothing listens on 4871 or 4872 afterwards", async () => {
  for (const p of Object.values(STAGE_PORTS)) assert.equal(await portBusy(p), false, String(p));
});
