// Higgsfield's tools for the door (PLAN-V5 K21): prices, uploads, jobs, the balance and the
// outputs, against the stand-in Higgsfield (T67), and against made-up MCP answers where the
// stand-in has no such shape. Made-up tokens; every socket lands on 127.0.0.1.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HF_ORIGIN, HF_PATHS, checkHfOrigin, createHiggsfield, creditsIn, tokenGuard } from "../higgsfield.mjs";
import { createMcpClient } from "../mcp.mjs";
import { createHfAuth } from "../oauth.mjs";
import { HF_UPLOAD_SUFFIXES, rowOf } from "../registry.mjs";
import { CDN_HOST, UPLOAD_HOST, mp4Bytes, pngBytes, startHiggsfield } from "../../test/stubs/higgsfield.mjs";

const REDIRECT = "http://127.0.0.1:41999/api/generation/higgsfield/back";
const FLUX = rowOf("hf.flux_2");
const WAN = rowOf("hf.wan2_6");
const UPSCALE = rowOf("hf.upscale_image");
const MEDIA = "media_0123456789abcdef";
const fluxJob = (over = {}) => ({ kind: "still_variation", prompt: "the stair at dawn", ratio: "16:9", resolution: "2k", medias: [{ mediaId: MEDIA, role: "ref" }], ...over });
const wanJob = (over = {}) => ({ kind: "image_to_video", prompt: "a slow push", ratio: "16:9", resolution: "1080p", seconds: 5, medias: [{ mediaId: MEDIA, role: "ref" }], ...over });

// The door's three Higgsfield parts, signed in to the stand-in.
async function ready(behaviour = {}, opts = {}) {
  const hf = await startHiggsfield({ behaviour });
  const file = join(mkdtempSync(join(tmpdir(), "hf-tools-")), "secrets", "doors", "higgsfield-oauth.json");
  const auth = createHfAuth({ origin: hf.url, file, redirectUri: REDIRECT, net: hf.net });
  const b = await auth.begin();
  const u = new URL(b.url);
  const back = new URL((await fetch(`${hf.url}${u.pathname}${u.search}`, { redirect: "manual" })).headers.get("location"));
  assert.deepEqual(await auth.finish({ code: back.searchParams.get("code"), state: back.searchParams.get("state") }), { ok: true });
  const mcp = createMcpClient({ origin: hf.url, token: (o) => auth.token(o), net: hf.net });
  const net = opts.net ? opts.net(hf) : hf.net;
  const h = createHiggsfield({ mcp, net, uploadSuffixes: opts.uploadSuffixes, limits: opts.limits });
  return { hf, auth, mcp, h };
}
// An MCP client of made-up answers: `answers(name, args)` gives { ok, result } or a failure.
function fakeMcp(answers) {
  const calls = [];
  return {
    calls,
    async call(name, args) { calls.push({ name, args }); return answers(name, args); },
    scrub: tokenGuard(["hfat_" + "9".repeat(40)]).scrub,
  };
}
const tool = (hf, name) => hf.calls.filter((c) => c.rpc === "tools/call" && c.tool === name);
// The stand-in's network, with every byte the door writes to the upload host kept.
const capturing = (sent) => (hf) => ({
  resolve: (host) => hf.net.resolve(host),
  connect(o) {
    const sock = hf.net.connect(o);
    if (o.hostname === UPLOAD_HOST) {
      const write = sock.write.bind(sock);
      sock.write = (chunk, ...rest) => { sent.push(Buffer.from(chunk).toString("latin1")); return write(chunk, ...rest); };
    }
    return sock;
  },
});

test("one origin: Higgsfield's own MCP host, or a stand-in on 127.0.0.1", () => {
  const up = checkHfOrigin(HF_ORIGIN);
  assert.deepEqual([up.protocol, up.port, up.standIn, up.resource], ["https:", 443, false, `${HF_ORIGIN}/mcp`]);
  assert.equal(up.hostname, new URL(HF_ORIGIN).hostname);
  assert.equal(checkHfOrigin("http://127.0.0.1:4100").standIn, true);
  for (const bad of [`${HF_ORIGIN}/`, `${HF_ORIGIN}:443`, HF_ORIGIN.replace("https", "http"), "https://clerk.higgsfield.ai", "http://localhost:4100", "http://127.0.0.1:4100/mcp", "http://127.0.0.1:70000", null]) {
    assert.throws(() => checkHfOrigin(bad), /origin must be/, String(bad));
  }
  assert.deepEqual(HF_PATHS, { mcp: "/mcp", register: "/oauth2/register", authorize: "/oauth2/authorize", token: "/oauth2/token" });
});

test("tokenGuard scrubs both tokens whole, in their JSON and percent spellings and by their ends, and cuts to 300", () => {
  const a = `eyJhbGciOiJSUzI1NiJ9.${"a1".repeat(30)}/+=`;
  const r = `hfrt_${"7c".repeat(24)}`;
  const g = tokenGuard([a, r]);
  const text = `x ${a} ${encodeURIComponent(a)} ${JSON.stringify(a).slice(1, -1)} ${r.slice(0, 12)}..${r.slice(-12)} ${"‮"}${"z".repeat(400)}`;
  const out = g.scrub(text);
  assert.ok(out.length <= 300);
  for (const p of [a, encodeURIComponent(a), a.slice(0, 12), a.slice(-12), r.slice(0, 12), r.slice(-12), "‮"]) assert.ok(!out.includes(p), p);
  assert.equal(g.holds(`https://x.test/?t=${encodeURIComponent(r)}`), true);
  assert.equal(g.holds(`a signed address ${r.slice(-12)}`), true);
  assert.equal(g.holds("eyJhbGciOiJSUzI1NiJ9.another-jwt-entirely"), false);   // only a JWT's shared head
  assert.equal(tokenGuard([]).scrub("plain\nwords\u0000"), "plain words");
});

test("balance: the owner's credits and plan", async () => {
  const { hf, h } = await ready({ credits: 1234 });
  try {
    assert.deepEqual(await h.balance(), { ok: true, credits: 1234, plan: "max" });
  } finally { await hf.close(); }
  const odd = createHiggsfield({ mcp: fakeMcp(() => ({ ok: true, result: { balance: "77.5", plan: "<b>evil</b>" } })) });
  assert.deepEqual(await odd.balance(), { ok: true, credits: 77.5, plan: null });
  const none = createHiggsfield({ mcp: fakeMcp(() => ({ ok: true, result: { credits: -3 } })) });
  assert.deepEqual(await none.balance(), { ok: false, why: "no_balance", text: "" });
});

test("cost asks with get_cost and exactly the job's arguments: FLUX.2 at variant max, sizes in small letters, never unlim", async () => {
  const { hf, h } = await ready();
  try {
    assert.deepEqual(await h.cost(FLUX, fluxJob()), { ok: true, credits: 4 });
    const asked = tool(hf, "generate_image")[0].arguments;
    assert.deepEqual(asked, { params: {
      model: "flux_2", prompt: "the stair at dawn", aspect_ratio: "16:9", resolution: "2k", medias: [{ value: MEDIA, role: "image_references" }],
      variant: "max", use_unlim: false, use_free_gens: false, get_cost: true,
    } });
    const started = await h.start(FLUX, fluxJob());
    assert.equal(started.ok, true);
    const real = tool(hf, "generate_image")[1].arguments;
    const { get_cost: _gc, ...rest } = asked.params;
    assert.deepEqual(real, { params: rest });
    assert.deepEqual(await h.cost(WAN, wanJob()), { ok: true, credits: 35 });
    assert.deepEqual(tool(hf, "generate_video")[0].arguments.params, {
      model: "wan2_6", prompt: "a slow push", aspect_ratio: "16:9", quality: "1080p", duration: 5, medias: [{ value: MEDIA, role: "image_references" }],
      use_unlim: false, use_free_gens: false, get_cost: true,
    });
    assert.deepEqual(await h.cost(UPSCALE, { kind: "still_upscale", prompt: "", resolution: "4k", medias: [{ mediaId: MEDIA, role: "image" }], width: 1600, height: 900 }), { ok: true, credits: 8 });
    assert.deepEqual(tool(hf, "upscale_image")[0].arguments, { image_id: MEDIA, width: 1600, height: 900, resolution: "4k", provider: "bytedance", get_cost: true });
  } finally { await hf.close(); }
});

test("priceHigher: the live price is read as Higgsfield states it (the door compares it with its table)", async () => {
  const { hf, h } = await ready({ priceHigher: true });
  try {
    assert.deepEqual(await h.cost(FLUX, fluxJob()), { ok: true, credits: 6 });
  } finally { await hf.close(); }
});

test("a job the row does not allow never reaches Higgsfield", async () => {
  const mcp = fakeMcp(() => { throw new Error("must not be called"); });
  const h = createHiggsfield({ mcp });
  for (const [row, job] of [
    [FLUX, fluxJob({ ratio: "21:9" })], [FLUX, fluxJob({ resolution: "2K" })], [FLUX, fluxJob({ kind: "image_to_video" })],
    [FLUX, fluxJob({ prompt: "x".repeat(4001) })], [FLUX, fluxJob({ medias: [{ mediaId: "a/b", role: "ref" }] })],
    [FLUX, fluxJob({ medias: [{ mediaId: MEDIA, role: "first" }] })], [WAN, wanJob({ seconds: 6 })], [WAN, wanJob({ medias: [{ mediaId: MEDIA, role: "ref" }, { mediaId: MEDIA, role: "ref" }] })],
    [UPSCALE, { kind: "still_upscale", prompt: "", resolution: "4k", medias: [{ mediaId: MEDIA, role: "image" }], width: 0, height: 900 }],
    [rowOf("gen4_turbo"), { kind: "image_to_video", prompt: "p", ratio: "1280:720", seconds: 5, medias: [] }],
  ]) {
    assert.equal((await h.cost(row, job)).ok, false);
    const s = await h.start(row, job);
    assert.equal(s.ok, false);
    assert.equal(s.clear, true);
  }
  assert.equal(mcp.calls.length, 0);
});

test("a price answer that names a job is refused as started; no price is no price; numbers must be finite and at least 0", async () => {
  const answers = [{ job_id: "job_1", credits: 4 }, { jobs: [{ job_id: "job_2" }], credits: 4 }, { credits: -1 }, { credits: "NaN" }, { credits: "1e3" }, {},
    { jobs: [], credits: 4 }, { cost: { credits: 3 } }, { result: { total_credits: "2.5" } }];
  let i = 0;
  const h = createHiggsfield({ mcp: fakeMcp(() => ({ ok: true, result: answers[i++] })) });
  assert.deepEqual(await h.cost(FLUX, fluxJob()), { ok: false, why: "job_started", jobId: "job_1", text: "" });
  assert.deepEqual(await h.cost(FLUX, fluxJob()), { ok: false, why: "job_started", jobId: "job_2", text: "" });
  for (let k = 0; k < 4; k += 1) assert.deepEqual(await h.cost(FLUX, fluxJob()), { ok: false, why: "no_price", text: "" });
  assert.deepEqual(await h.cost(FLUX, fluxJob()), { ok: true, credits: 4 });
  assert.deepEqual(await h.cost(FLUX, fluxJob()), { ok: true, credits: 3 });
  assert.deepEqual(await h.cost(FLUX, fluxJob()), { ok: true, credits: 2.5 });
  assert.equal(creditsIn({ credits: Number.MAX_VALUE }), Number.MAX_VALUE);
  assert.equal(creditsIn({ credits: 0 }), 0);
});

test("a job: started, waited on until done, and its picture and its clip fetched", async () => {
  const { hf, h } = await ready();
  try {
    const s = await h.start(FLUX, fluxJob());
    assert.equal(s.ok, true);
    assert.match(s.jobId, /^job_[0-9a-f]{16}$/);
    assert.equal(s.credits, 4);
    const w1 = await h.wait(s.jobId, 0);
    assert.deepEqual(w1, { ok: true, url: null, cost: null, costZero: false, reason: "", state: "working" });
    const w2 = await h.wait(s.jobId, 0);
    assert.equal(w2.state, "done");
    assert.equal(w2.url, `https://${CDN_HOST}/out/${s.jobId}.png`);
    const out = await h.output(w2.url, "picture");
    assert.equal(out.ok, true);
    assert.deepEqual(out.kind, { type: "image/png", ext: "png" });
    assert.deepEqual(out.body, pngBytes());
    assert.equal(out.host, CDN_HOST);
    assert.deepEqual(tool(hf, "jobs_wait")[0].arguments, { jobs: [{ index: 0, job_id: s.jobId }], timeout_seconds: 0 });
    const v = await h.start(WAN, wanJob());
    await h.wait(v.jobId, 99);
    assert.equal(tool(hf, "jobs_wait")[2].arguments.timeout_seconds, 15);
    const vd = await h.wait(v.jobId, 15);
    const clip = await h.output(vd.url, "video");
    assert.deepEqual(clip.kind, { type: "video/mp4", ext: "mp4" });
    assert.deepEqual(clip.body, mp4Bytes());
    assert.equal((await h.output(vd.url, "picture")).why, "not_media");
    assert.equal(hf.calls.filter((c) => c.path.startsWith("/out/")).every((c) => c.hasAuth === false), true);
  } finally { await hf.close(); }
});

test("nsfw is refused and failed is failed; slow stays working", async () => {
  for (const [behaviour, state] of [["nsfw", "refused"], ["failed", "failed"], ["slow", "working"]]) {
    const { hf, h } = await ready({ [behaviour]: true });
    try {
      const s = await h.start(FLUX, fluxJob());
      await h.wait(s.jobId, 0);
      const w = await h.wait(s.jobId, 0);
      assert.equal(w.state, state, behaviour);
      assert.equal(w.url, null);
      if (behaviour !== "slow") assert.ok(w.reason.length > 0);
    } finally { await hf.close(); }
  }
});

test("wait reads tolerant shapes, and any answer it cannot place is unknown", async () => {
  const id = "job_abc";
  const shapes = [
    [{ jobs: [{ job_id: id, status: "COMPLETED", result: { url: "https://cdn.example.com/a.png" } }] }, "done", "https://cdn.example.com/a.png"],
    [{ job_id: id, state: "succeeded", output: { url: "https://cdn.example.com/b.mp4" } }, "done", "https://cdn.example.com/b.mp4"],
    [{ status: "done", images: [{ url: "https://cdn.example.com/c.png" }] }, "done", "https://cdn.example.com/c.png"],
    [{ jobs: [{ id, status: "in_progress" }] }, "working", null],
    [{ jobs: [{ job_id: id, status: "content_policy", error: { message: "flagged" } }] }, "refused", null],
    [{ jobs: [{ job_id: id, status: "cancelled", cost: 0 }] }, "failed", null],
    [{ jobs: [{ job_id: "job_other", status: "completed", result: { url: "https://cdn.example.com/x.png" } }] }, "unknown", null],
    [{ jobs: [{ job_id: id, status: "teleported" }] }, "unknown", null],
    [{ jobs: [{ job_id: id, status: "completed" }, { job_id: id, status: "failed" }] }, "unknown", null],
    [{ jobs: "nope" }, "unknown", null],
  ];
  let i = 0;
  const h = createHiggsfield({ mcp: fakeMcp(() => ({ ok: true, result: shapes[i++][0] })) });
  for (const [, state, url] of shapes) {
    const w = await h.wait(id, 3);
    assert.equal(w.state, state, JSON.stringify(shapes[i - 1][0]));
    assert.equal(w.url, url);
  }
  const zero = createHiggsfield({ mcp: fakeMcp(() => ({ ok: true, result: { jobs: [{ job_id: id, status: "failed", credits: 0 }] } })) });
  assert.deepEqual(await zero.wait(id), { ok: true, url: null, cost: 0, costZero: true, reason: "", state: "failed" });
  assert.deepEqual(await h.wait("job/../x"), { ok: false, why: "bad_job_id", text: "" });
});

test("a start answer with a job id holding a slash, two job ids or none is refused, and not clear", async () => {
  const answers = [{ job_id: "a/b" }, { job_id: "../x" }, { jobs: [{ job_id: "j1" }, { job_id: "j2" }] }, { status: "queued" }, { job_id: "x".repeat(81) }, { job: { id: "job_ok" }, credits: "4" }];
  let i = 0;
  const h = createHiggsfield({ mcp: fakeMcp(() => ({ ok: true, result: answers[i++] })) });
  for (const why of ["bad_job_id", "bad_job_id", "several_jobs", "no_job_id", "bad_job_id"]) assert.deepEqual(await h.start(FLUX, fluxJob()), { ok: false, why, text: "", clear: false });
  assert.deepEqual(await h.start(FLUX, fluxJob()), { ok: true, jobId: "job_ok", credits: 4 });
});

test("start says whether anything can have started: a clear refusal, or an answer lost on the way", async () => {
  const cases = [
    [{ ok: false, why: "tool_error", text: "Not enough credits.", sent: true, status: 200 }, true],
    [{ ok: false, why: "rpc_error", text: "", sent: true, status: 200 }, true],
    [{ ok: false, why: "signed_out", text: "", sent: false, status: null }, true],
    [{ ok: false, why: "status", text: "", sent: true, status: 400 }, true],
    [{ ok: false, why: "unauthorized", text: "", sent: true, status: 401 }, true],
    [{ ok: false, why: "limited", text: "", sent: true, status: 429 }, true],
    [{ ok: false, why: "redirect", text: "", sent: true, status: 307 }, false],
    [{ ok: false, why: "status", text: "", sent: true, status: 502 }, false],
    [{ ok: false, why: "time", text: "", sent: true, status: null }, false],
    [{ ok: false, why: "not_json", text: "", sent: true, status: 200 }, false],
    [{ ok: false, why: "token_in_answer", text: "", sent: true, status: 200 }, false],
  ];
  let i = 0;
  const h = createHiggsfield({ mcp: fakeMcp(() => cases[i++][0]) });
  for (const [answer, clear] of cases) {
    const s = await h.start(FLUX, fluxJob());
    assert.deepEqual(s, { ok: false, why: answer.why, text: answer.text, clear }, answer.why);
  }
});

test("upload: nothing at all is sent while no upload host is recorded", async () => {
  assert.equal(HF_UPLOAD_SUFFIXES.length, 0);
  const { hf, h } = await ready();
  try {
    assert.deepEqual(await h.upload({ type: "image/png", bytes: pngBytes() }), { ok: false, why: "upload_host_unknown" });
    assert.equal(tool(hf, "media_upload").length, 0);
    assert.equal(hf.calls.filter((c) => c.method === "PUT").length, 0);
  } finally { await hf.close(); }
  assert.throws(() => createHiggsfield({ mcp: fakeMcp(() => ({})), uploadSuffixes: ["*.evil"] }), /suffixes/);
});

test("upload: one PUT to the recorded host with only Content-Type and the answer's own headers, then confirmed", async () => {
  const sent = [];
  const { hf, h } = await ready({}, { uploadSuffixes: ["higgsfield.test"], net: capturing(sent) });
  try {
    const bytes = pngBytes(640, 360);
    const r = await h.upload({ type: "image/png", bytes });
    assert.equal(r.ok, true, r.why);
    assert.match(r.mediaId, /^media_[0-9a-f]{16}$/);
    assert.deepEqual(tool(hf, "media_upload")[0].arguments, { filename: "input.png", content_type: "image/png" });
    assert.deepEqual(tool(hf, "media_confirm")[0].arguments, { type: "image", media_id: r.mediaId });
    const put = hf.calls.filter((c) => c.method === "PUT");
    assert.equal(put.length, 1);
    assert.deepEqual([put[0].hasAuth, put[0].size, put[0].contentType], [false, bytes.length, "image/png"]);
    const raw = sent.join("");
    const head = raw.slice(0, raw.indexOf("\r\n\r\n")).split("\r\n");
    assert.equal(head[0], `PUT /upload/${r.mediaId} HTTP/1.1`);
    assert.deepEqual(head.slice(1).map((l) => l.split(":")[0].toLowerCase()).sort(), ["connection", "content-length", "content-type", "host"]);
    assert.ok(head.includes(`Host: ${UPLOAD_HOST}`));
  } finally { await hf.close(); }
});

test("upload: refused before a byte is sent to a host outside the suffixes, an http address or a private one; a redirect is not followed", async () => {
  const slot = (url, headers) => (name) => (name === "media_upload" ? { ok: true, result: { media_id: MEDIA, upload_url: url, upload_headers: headers } } : { ok: true, result: { status: "ready" } });
  const looked = [];
  const net = { resolve: async (host) => { looked.push(host); return [{ address: host === "private.higgsfield.test" ? "10.1.2.3" : "13.32.0.12", family: 4 }]; },
    connect: () => { throw new Error("must not connect"); } };
  const opts = { net, uploadSuffixes: ["higgsfield.test"] };
  const up = (url, headers) => createHiggsfield({ mcp: fakeMcp(slot(url, headers)), ...opts }).upload({ type: "image/png", bytes: pngBytes() });
  assert.equal((await up("https://upload.evil.test/u/1")).why, "upload_host");
  assert.equal((await up("https://higgsfield.test.evil.test/u/1")).why, "upload_host");
  assert.equal((await up("http://upload.higgsfield.test/u/1")).why, "upload_address");
  assert.equal((await up("https://13.32.0.12/u/1")).why, "upload_address");
  assert.equal((await up("https://upload.higgsfield.test:8443/u/1")).why, "upload_address");
  assert.equal((await up("https://upload.higgsfield.test:80/u/1")).why, "upload_address");
  assert.equal((await up("https://upload.higgsfield.test/u/1", { "X-Amz-Meta": "line\r\nInjected: 1" })).why, "upload_headers");
  assert.deepEqual(looked, []);
  assert.equal((await up("https://private.higgsfield.test/u/1")).why, "upload_private_address");
  assert.deepEqual(looked, ["private.higgsfield.test"]);
  const bad = createHiggsfield({ mcp: fakeMcp(() => ({ ok: true, result: { media_id: "a/b", upload_url: "https://upload.higgsfield.test/u" } })), ...opts });
  assert.equal((await bad.upload({ type: "image/png", bytes: pngBytes() })).why, "bad_media_id");
  assert.equal((await bad.upload({ type: "image/gif", bytes: pngBytes() })).why, "bad_picture");

  const { hf, h } = await ready({ uploadRedirect: true }, { uploadSuffixes: ["higgsfield.test"] });
  try {
    assert.deepEqual(await h.upload({ type: "image/png", bytes: pngBytes() }), { ok: false, why: "upload_redirect" });
    assert.equal(hf.calls.filter((c) => c.method === "PUT").length, 1);
    assert.equal(tool(hf, "media_confirm").length, 0);
  } finally { await hf.close(); }
});

test("upload headers: Authorization, Cookie and Host from the answer are never passed on; the rest are", async () => {
  const sent = [];
  const headers = { Authorization: "Bearer stolen", Cookie: "a=b", Host: "evil.test", "Proxy-Authorization": "x", "x-amz-acl": "private", "Content-Type": "text/html" };
  const hf = await startHiggsfield();
  try {
    // The stand-in's answers name only Content-Type; this slot, on the stand-in's upload host, names more.
    const mcp = fakeMcp((name) => (name === "media_upload"
      ? { ok: true, result: { media_id: "media_x1", upload_url: `https://${UPLOAD_HOST}/upload/media_x1`, upload_headers: headers } }
      : { ok: true, result: { status: "ready" } }));
    const h = createHiggsfield({ mcp, net: capturing(sent)(hf), uploadSuffixes: ["higgsfield.test"] });
    const r = await h.upload({ type: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) });
    assert.equal(r.why, "upload_refused");     // the stand-in has no such slot: a 404, after the PUT
    assert.deepEqual(mcp.calls.map((c) => c.name), ["media_upload"]);
    const raw = sent.join("");
    const lines = raw.slice(0, raw.indexOf("\r\n\r\n")).split("\r\n").slice(1);
    assert.deepEqual(lines.map((l) => l.split(":")[0].toLowerCase()).sort(), ["connection", "content-length", "content-type", "host", "x-amz-acl"]);
    assert.ok(lines.includes("Content-Type: image/jpeg"));
    assert.ok(lines.includes(`Host: ${UPLOAD_HOST}`));
    assert.ok(!/stolen|a=b|evil\.test/.test(raw));
  } finally { await hf.close(); }
});

test("output: a redirect, more than the limit, an http or private address, and what is not media are refused", async () => {
  const { hf, h } = await ready({ outputRedirect: true });
  try {
    const url = `https://${CDN_HOST}/out/job_a.png`;
    assert.deepEqual(await h.output(url, "picture"), { ok: false, why: "redirect" });
    hf.behaviour.outputRedirect = false;
    hf.behaviour.bigOutput = true;
    assert.deepEqual(await h.output(`https://${CDN_HOST}/out/job_a.mp4`, "video"), { ok: false, why: "web_too_big" });
    hf.behaviour.bigOutput = false;
    assert.deepEqual(await h.output(`http://${CDN_HOST}/out/job_a.png`, "picture"), { ok: false, why: "address" });
    assert.deepEqual(await h.output("https://13.32.0.13/out/job_a.png", "picture"), { ok: false, why: "address" });
    assert.deepEqual(await h.output(`https://${CDN_HOST}/out/job_a.png`, "video"), { ok: false, why: "not_media" });
    assert.deepEqual(await h.output(url, "audio"), { ok: false, why: "want" });
    assert.equal((await h.output(url, "picture")).ok, true);
  } finally { await hf.close(); }
  const priv = createHiggsfield({ mcp: fakeMcp(() => ({})), net: { resolve: async () => [{ address: "10.0.0.5", family: 4 }], connect: () => { throw new Error("no"); } } });
  assert.deepEqual(await priv.output("https://cdn.example.com/a.png", "picture"), { ok: false, why: "web_private_address" });
});

test("a tool error's text reaches the door scrubbed and cut; the job's own reason too", async () => {
  const { hf, h } = await ready({ toolError: true });
  try {
    const token = hf.tokens.access;
    const r = await h.balance();
    assert.equal(r.why, "tool_error");
    assert.ok(!r.text.includes(token) && !r.text.includes(token.slice(-12)) && !r.text.includes(token.slice(0, 12)));
  } finally { await hf.close(); }
  const secret = "hfat_" + "9".repeat(40);
  const h2 = createHiggsfield({ mcp: fakeMcp(() => ({ ok: true, result: { jobs: [{ job_id: "job_r", status: "failed", error: `boom ${secret.slice(0, 12)}\u0000${"w".repeat(900)}` }] } })) });
  const w = await h2.wait("job_r");
  assert.equal(w.state, "failed");
  assert.ok(w.reason.length <= 300);
  assert.ok(!w.reason.includes(secret.slice(0, 12)) && !w.reason.includes("\u0000"));
});
