// The watch's two sandbox settings (engine/web/sandbox.mjs) and the walls they build, proved
// with the REAL sandbox tool (srt) against made-up tools and local stand-ins on 127.0.0.1:
// a read outside the job folder fails, a write outside fails, an address off the list is
// refused, the media tools have no network, and srt really reads every key we write (it
// ignores a misspelt one silently). Nothing here reaches the internet: the only names asked
// for are 127.0.0.1 and names ending .invalid, which srt refuses before any lookup.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DENY_READ, DENY_WRITE, PRIVATE_RANGES, downloadSettings, mediaSettings, writeJobSettings, writeSettings,
} from "../sandbox.mjs";
import { runBoxed } from "../watch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRT = join(HERE, "..", "..", "node_modules", ".bin", "srt");
const CURL = "/usr/bin/curl";
const NO_SRT = existsSync(SRT) ? false : `the sandbox tool is missing (${SRT}): run engine setup`;
const NO_CURL = existsSync(CURL) ? false : "curl is missing on this Mac";

let root; // a short temp folder (srt's control socket needs a short path)
let site;
let canary;
let canaryHits = 0;
const tools = () => ({ node: process.execPath, srt: realpathSync(SRT) });

before(async () => {
  root = realpathSync(mkdtempSync("/private/tmp/uuu-wt-"));
  site = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("SITE-OK"); });
  canary = net.createServer((s) => { canaryHits += 1; s.destroy(); });
  await new Promise((ok) => site.listen(0, "127.0.0.1", ok));
  await new Promise((ok) => canary.listen(0, "127.0.0.1", ok));
});
after(async () => {
  await new Promise((ok) => site.close(ok));
  await new Promise((ok) => canary.close(ok));
  rmSync(root, { recursive: true, force: true });
});

let n = 0;
function newJob(opts = {}) {
  n += 1;
  const job = join(root, `job${n}`);
  mkdirSync(job, { mode: 0o700 });
  const srtTmp = join(root, `t${n}`);
  mkdirSync(srtTmp, { mode: 0o700 });
  const files = writeJobSettings({ job, hosts: ["vimeo.com"], block: [], model: null, ...opts });
  return { job, srtTmp, ...files };
}
const run = (settingsPath, j, script, limitMs = 30_000) => runBoxed({
  tools: tools(), settingsPath, job: j.job, srtTmp: j.srtTmp, argv: ["/bin/sh", "-c", script, "probe"], limitMs,
}).then((r) => ({ ...r, out: r.stdout.toString("utf8") }));

// ---- the settings, as data ----------------------------------------------------------------

test("the settings for a job name only that job's folder for writing and deny the owner's home", () => {
  const job = "/private/tmp/x/doors/work/watch/AAAAAAAAAAAAAAAA";
  const d = downloadSettings({ job, hosts: ["youtube.com", "youtu.be", "BAD HOST", "*.vimeo.com", "127.0.0.1"], block: ["youtu.be"] });
  assert.deepEqual(d.filesystem.allowWrite, [job]);
  assert.deepEqual(d.filesystem.allowRead, [job]);
  assert.deepEqual(d.filesystem.denyRead, ["/Users", "/Volumes", "/private/tmp", "/private/var/folders"]);
  assert.ok(d.filesystem.denyRead.some((p) => homedir().startsWith(`${p}/`)), "the owner's home is under a denied folder");
  assert.deepEqual(d.filesystem.denyWrite, ["/tmp/claude", "/private/tmp/claude"]);
  // Each host and its sub-domains; a bad entry, an IP and a blocked host are not allowed.
  assert.deepEqual(d.network.allowedDomains, ["youtube.com", "*.youtube.com", "vimeo.com", "*.vimeo.com"]);
  assert.deepEqual(d.network.deniedDomains, ["youtu.be", "*.youtu.be"]);
  assert.equal(d.network.strictAllowlist, true);
  assert.deepEqual(d.network.deniedResolvedAddresses, [...PRIVATE_RANGES]);
  for (const r of ["10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "::1/128", "fc00::/7", "fe80::/10"]) {
    assert.ok(PRIVATE_RANGES.includes(r), r);
  }
  const m = mediaSettings({ job, model: "/x/state/media/models/ggml-small.en.bin" });
  assert.deepEqual(m.filesystem.allowWrite, [job]);
  assert.deepEqual(m.filesystem.allowRead, [job, "/x/state/media/models/ggml-small.en.bin"]);
  assert.deepEqual(m.network.allowedDomains, []);
  assert.equal(m.network.strictAllowlist, true);
  assert.deepEqual([...DENY_READ], d.filesystem.denyRead);
  assert.deepEqual([...DENY_WRITE], m.filesystem.denyWrite);
});

test("settings are written 0600 beside the job folder, never over a file or through a link", () => {
  const j = newJob();
  assert.equal(j.download, `${j.job}.download.json`);
  assert.equal(j.media, `${j.job}.media.json`);
  for (const p of [j.download, j.media]) assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(j.download, "utf8")), j.settings.download);
  assert.throws(() => writeSettings(j.download, {}), /EEXIST/);
});

// ---- the walls, with the real sandbox tool ---------------------------------------------------

test("a made-up tool cannot read a file outside the job folder or list the owner's home (real srt)", { skip: NO_SRT }, async () => {
  const j = newJob();
  const secret = join(root, "owner-secret.txt");
  writeFileSync(secret, "TOP-SECRET-VALUE");
  writeFileSync(join(j.job, "inside.txt"), "INSIDE-OK");
  for (const settings of [j.download, j.media]) {
    const r = await run(settings, j, `
      cat inside.txt; echo
      if cat '${secret}' >/dev/null 2>&1; then echo READ-SECRET; else echo secret-denied; fi
      if ls '${homedir()}' >/dev/null 2>&1; then echo READ-HOME; else echo home-denied; fi
      if ls '${homedir()}/.ssh' >/dev/null 2>&1; then echo READ-SSH; else echo ssh-denied; fi`);
    assert.match(r.out, /INSIDE-OK/, "the job folder itself is readable (control)");
    assert.match(r.out, /secret-denied/);
    assert.match(r.out, /home-denied/);
    assert.match(r.out, /ssh-denied/);
    assert.doesNotMatch(r.out, /READ-|TOP-SECRET/);
  }
});

test("a made-up tool cannot write outside the job folder (real srt)", { skip: NO_SRT }, async () => {
  const j = newJob();
  const outside = [join(root, "outside.txt"), join(dirname(root), `uuu-wt-out-${process.pid}.txt`), "/opt/homebrew/uuu-wt-out.txt", "/private/var/tmp/uuu-wt-out.txt"];
  for (const settings of [j.download, j.media]) {
    const r = await run(settings, j, `
      echo in > inside-w.txt && echo wrote-inside
      for f in ${outside.map((p) => `'${p}'`).join(" ")}; do
        if echo x > "$f" 2>/dev/null; then echo "WROTE $f"; else echo refused; fi
      done
      if ln -s / link 2>/dev/null && echo x > link/private/var/tmp/uuu-wt-link.txt 2>/dev/null; then echo WROTE-LINK; else echo link-refused; fi`);
    assert.match(r.out, /wrote-inside/, "the job folder is writable (control)");
    assert.doesNotMatch(r.out, /WROTE/);
    for (const p of outside) assert.equal(existsSync(p), false, p);
    try { unlinkSync(join(j.job, "link")); } catch { /* not made */ }
  }
});

test("the downloader reaches a listed stand-in but not a port or a name off the list (real srt)", { skip: NO_SRT || NO_CURL }, async () => {
  const sitePort = site.address().port;
  const canaryPort = canary.address().port;
  const j = newJob({ extra: [`127.0.0.1:${sitePort}`] });
  canaryHits = 0;
  const r = await run(j.download, j, `
    echo "listed=$(${CURL} -s -m 5 http://127.0.0.1:${sitePort}/)"
    echo "canary=$(${CURL} -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:${canaryPort}/)"
    echo "direct=$(${CURL} -s -m 5 --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:${canaryPort}/)"
    echo "offlist=$(${CURL} -s -m 5 -o /dev/null -w '%{http_code}' http://offlist.invalid/)"`);
  assert.match(r.out, /listed=SITE-OK/, "a listed address is reached (control: the network is not simply dead)");
  assert.match(r.out, /canary=(403|000)/);
  assert.match(r.out, /direct=000/);
  assert.match(r.out, /offlist=(403|000)/);
  assert.equal(canaryHits, 0, "the canary saw nothing");
});

test("the media tools have no network at all (real srt)", { skip: NO_SRT || NO_CURL }, async () => {
  const sitePort = site.address().port;
  const j = newJob({ extra: [`127.0.0.1:${sitePort}`] });
  canaryHits = 0;
  const r = await run(j.media, j, `
    echo "site=$(${CURL} -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:${sitePort}/)"
    echo "direct=$(${CURL} -s -m 5 --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:${canary.address().port}/)"`);
  assert.match(r.out, /site=(403|000)/);
  assert.match(r.out, /direct=000/);
  assert.equal(canaryHits, 0);
});

// srt silently ignores a key it does not know. So for each key we write, a settings file with
// that key's value broken must stop srt from starting: then the key is one srt reads. The
// control proves the check means something: the same broken value under a misspelt key runs.
test("srt reads every key we write: a broken value under each stops it, a misspelt key is ignored (real srt)", { skip: NO_SRT }, async () => {
  const j = newJob();
  const base = j.settings.download;
  const broken = {
    "filesystem.denyRead": [5], "filesystem.allowRead": [5], "filesystem.allowWrite": [5], "filesystem.denyWrite": [5],
    "network.allowedDomains": ["*"], "network.deniedDomains": [5], "network.strictAllowlist": "yes",
    "network.deniedResolvedAddresses": ["10.0.0.0/33"],
  };
  // Every key of both settings objects is covered.
  const keys = (s) => Object.entries(s).flatMap(([k, v]) => Object.keys(v).map((x) => `${k}.${x}`));
  for (const k of new Set([...keys(base), ...keys(j.settings.media)])) assert.ok(Object.hasOwn(broken, k), `a test for ${k}`);
  let i = 0;
  const tryWith = async (settings) => {
    i += 1;
    const p = join(root, `keys-${n}-${i}.json`);
    writeSettings(p, settings);
    return run(p, j, "echo RAN");
  };
  const ok = await tryWith(base);
  assert.match(ok.out, /RAN/, "the settings as written start (control)");
  for (const [key, value] of Object.entries(broken)) {
    const [a, b] = key.split(".");
    const r = await tryWith({ ...base, [a]: { ...base[a], [b]: value } });
    assert.doesNotMatch(r.out, /RAN/, `srt started with a broken ${key}: it does not read that key`);
    assert.notEqual(r.code, 0);
  }
  const misspelt = await tryWith({ ...base, network: { ...base.network, deniedResolvedAdresses: ["10.0.0.0/33"] } });
  assert.match(misspelt.out, /RAN/, "a misspelt key is ignored (which is why the check above matters)");
});
