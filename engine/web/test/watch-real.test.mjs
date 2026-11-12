// The watch with the REAL programs: yt-dlp, ffprobe, ffmpeg and whisper-cli, each inside its
// own srt sandbox, against a stand-in video site on 127.0.0.1 (rule 6: no outside host). The
// stand-in is not a watch host by name, so three test-only seams are used and nothing else:
// a permissive address check (the real one refuses any IP, rightly), the stand-in's
// `127.0.0.1:<port>` added to the downloader's sandbox list, and the generic extractors
// (`generic,html5`) in place of `youtube,vimeo`. The length rule stays strict, as in the door.
// The clip is made here by ffmpeg and macOS's `say`; the speech model is read in place from
// the engine's state folder when it is there (by name, never copied).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostAllowed } from "../address.mjs";
import { createWatch } from "../watch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRT = join(HERE, "..", "..", "node_modules", ".bin", "srt");
const MODEL = join(homedir(), ".paperclip", "uuu-engine", "media", "models", "ggml-small.en.bin");
const NEED = [[SRT, "the sandbox tool"], ["/opt/homebrew/bin/yt-dlp", "yt-dlp"], ["/opt/homebrew/bin/ffmpeg", "ffmpeg"],
  ["/opt/homebrew/bin/ffprobe", "ffprobe"], ["/usr/bin/say", "say"]];
const missing = NEED.filter(([p]) => !existsSync(p)).map(([, n]) => n);
const SKIP = missing.length ? `missing on this Mac: ${missing.join(", ")}` : false;
const NO_SPEECH = SKIP || ([["/opt/homebrew/bin/whisper-cli", "whisper-cli"], [MODEL, "the speech model"]]
  .filter(([p]) => !existsSync(p)).map(([, n]) => `missing on this Mac: ${n}`)[0] || false);
const SPOKEN = "Brick houses in the morning light.";

let root;
let site;
let canary;
let canaryHits = 0;
let clip;

// A permissive address check for the stand-in only: http on 127.0.0.1 with a port.
const standInAddress = (text) => {
  try {
    const u = new URL(text);
    if (u.protocol !== "http:" || u.hostname !== "127.0.0.1") return { ok: false };
    return { ok: true, href: u.href, host: u.hostname };
  } catch {
    return { ok: false };
  }
};

before(async () => {
  root = realpathSync(mkdtempSync("/private/tmp/uuu-wr-"));
  if (SKIP) return;
  execFileSync("/usr/bin/say", ["-o", join(root, "speech.aiff"), SPOKEN]);
  execFileSync("/opt/homebrew/bin/ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=6",
    "-i", join(root, "speech.aiff"), "-filter_complex", "[1:a]apad=whole_dur=6[a]", "-map", "0:v", "-map", "[a]", "-t", "6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", join(root, "clip.mp4")]);
  clip = readFileSync(join(root, "clip.mp4"));
  canary = net.createServer((s) => { canaryHits += 1; s.destroy(); });
  await new Promise((ok) => canary.listen(0, "127.0.0.1", ok));
  site = http.createServer((req, res) => {
    const me = `http://127.0.0.1:${site.address().port}`;
    const page = (body, head = "") => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><html><head><title>Stand-in</title>${head}</head><body>${body}</body></html>`);
    };
    const ld = (url, duration) => `<script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject",`
      + `"name":"Brick houses at dawn","duration":"${duration}","contentUrl":"${url}","uploadDate":"2026-01-01"}</script>`;
    if (req.url === "/v/clip") return page("<p>clip</p>", ld(`${me}/m/clip.mp4`, "PT6S"));
    if (req.url === "/v/long") return page("<p>long</p>", ld(`${me}/m/clip.mp4`, "PT30M"));
    if (req.url === "/v/nolength") return page('<video controls><source src="/m/clip.mp4" type="video/mp4"></video>');
    if (req.url === "/v/canary") return page("<p>c</p>", ld(`http://127.0.0.1:${canary.address().port}/stolen.mp4`, "PT6S"));
    if (req.url === "/m/clip.mp4") {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": clip.length });
      return res.end(clip);
    }
    res.writeHead(404);
    return res.end();
  });
  await new Promise((ok) => site.listen(0, "127.0.0.1", ok));
});
after(async () => {
  if (site) await new Promise((ok) => site.close(ok));
  if (canary) await new Promise((ok) => canary.close(ok));
  rmSync(root, { recursive: true, force: true });
});

function make() {
  return createWatch({
    paths: { work: join(root, "doors", "work") },
    tools: { extractors: "generic,html5", extraDomains: [`127.0.0.1:${site.address().port}`], model: MODEL },
    log: () => {},
    checkAddress: standInAddress,
    hostAllowed,
  });
}
const STATE = { watchHosts: ["127.0.0.1"], allow: [], block: [] };
async function watchOnce(path, frames) {
  const w = make();
  const t0 = Date.now();
  const s = w.start({ slug: "researcher", url: `http://127.0.0.1:${site.address().port}${path}`, frames, state: STATE });
  assert.equal(s.status, 202);
  let v;
  for (;;) {
    v = w.job({ slug: "researcher", job: s.json.job }).json;
    if (v.state !== "working") break;
    await new Promise((ok) => setTimeout(ok, 200));
  }
  const ms = Date.now() - t0;
  const frame = v.frames > 0 ? w.frame({ slug: "researcher", job: s.json.job, n: 1 }).png : null;
  await w.close();
  assert.deepEqual(readdirSync(join(root, "doors", "work", "watch")), [], "nothing is left behind");
  return { v, ms, frame };
}

test("a short clip: real yt-dlp fetches, ffmpeg takes frames, whisper-cli writes the words, each in its sandbox", { skip: NO_SPEECH }, async (t) => {
  const { v, ms, frame } = await watchOnce("/v/clip", 4);
  assert.equal(v.state, "done", v.reason);
  assert.equal(v.title, "Brick houses at dawn");
  assert.equal(v.seconds, 6);
  assert.equal(v.frames, 4);
  assert.equal(v.transcript.source, "speech");
  assert.match(v.transcript.text.toLowerCase(), /brick houses/);
  assert.equal(frame.readUInt32BE(16), 640);
  assert.equal(frame.readUInt32BE(20), 360);
  t.diagnostic(`a 6-second clip, fetched, framed and transcribed: ${ms} ms`);
});

test("a video of unknown length, and one longer than 20 minutes, are not fetched (the strict length rule)", { skip: SKIP }, async () => {
  for (const path of ["/v/nolength", "/v/long"]) {
    const { v } = await watchOnce(path, 4);
    assert.equal(v.state, "failed", path);
    assert.match(v.reason, /No video was fetched/);
    // (The generic extractor may open the file to read its headers; nothing is kept.)
  }
});

test("a page that points the downloader at another local port gets nothing from it", { skip: SKIP }, async () => {
  canaryHits = 0;
  const { v } = await watchOnce("/v/canary", 4);
  assert.equal(v.state, "failed");
  assert.equal(canaryHits, 0, "the canary saw nothing");
});
