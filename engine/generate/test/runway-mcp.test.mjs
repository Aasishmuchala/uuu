// Runway's MCP server as the door reads it (PLAN-ONBOARD R1): the first answer of a generation
// tool (a quote, a job that started, or neither), the approved call, a task's state, the upload's
// pinned host, the balance, and the tools the door may call. A fake MCP client stands in for the
// network; a guard fails the file if any socket is opened to a host other than 127.0.0.1.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import dc from "node:diagnostics_channel";
import net from "node:net";
import { createMcpClient } from "../mcp.mjs";
import { ACCOUNT_ROWS, RW_UPLOAD_SUFFIXES, accountRowFor } from "../registry.mjs";
import {
  QUOTE_MARK, RW_MCP_ORIGIN, RW_PATHS, RW_TOOLS, checkRwOrigin, checkRwUploadAddress, createRunwayMcp, readFirstAnswer,
} from "../runway-mcp.mjs";

const strays = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guarded(...args) {
  const a = args[0];
  const o = Array.isArray(a) ? a[0] : a;
  const host = o !== null && typeof o === "object" ? (o.path ? "127.0.0.1" : o.host) : typeof args[1] === "string" ? args[1] : "localhost";
  if (host !== "127.0.0.1") strays.push(String(host));
  return realConnect.apply(this, args);
};
const onFetch = (m) => { const h = m && m.connectParams && m.connectParams.hostname; if (h !== "127.0.0.1") strays.push(String(h)); };
dc.subscribe("undici:client:beforeConnect", onFetch);
after(() => {
  net.Socket.prototype.connect = realConnect;
  dc.unsubscribe("undici:client:beforeConnect", onFetch);
  assert.deepEqual(strays, [], "a socket was opened to a host other than 127.0.0.1");
});

// A fake MCP client: answers from `script(name, args)`, records every call.
function fakeMcp(script) {
  const calls = [];
  return { calls, call: async (name, args) => { calls.push({ name, args }); return script(name, args); }, scrub: (t) => String(t).slice(0, 300) };
}
// A network that must never be used.
const deadNet = { resolve: async () => { throw new Error("no network in this test"); }, connect: () => { throw new Error("no network in this test"); } };
const TURBO = accountRowFor("gen4_turbo");
const IMAGE = accountRowFor("gen4_image");
const clip = { kind: "image_to_video", prompt: "a slow push in", ratio: "16:9", seconds: 5, assets: [{ url: "https://cdn.example/a.png", role: "first" }] };
const ok = (result) => ({ ok: true, result });

test("the constants are R0's: one origin, four paths, seven tools and no others", () => {
  assert.equal(RW_MCP_ORIGIN, "https://mcp.runwayml.com");
  assert.deepEqual({ ...RW_PATHS }, { mcp: "/mcp", register: "/register", authorize: "/authorize", token: "/token" });
  assert.deepEqual([...RW_TOOLS], ["whoami", "generate_image", "generate_video", "upscale_image", "get_task", "init_upload", "complete_upload"]);
  assert.deepEqual([...RW_UPLOAD_SUFFIXES], [], "no upload host is pinned until one is seen");
  assert.equal(QUOTE_MARK, "cost_confirmation_required");
});

test("the MCP client for Runway never calls a tool outside its list, and sends nothing for one", async () => {
  const c = createMcpClient({ origin: "http://127.0.0.1:9", token: async () => ({ ok: true, access: "x".repeat(20) }), net: deadNet,
    check: checkRwOrigin, path: RW_PATHS.mcp, tools: RW_TOOLS, label: "runway" });
  for (const name of ["run_workflow", "start_credits_checkout", "show_plans_and_credits", "edit_video", "balance", "jobs_wait", "media_upload"]) {
    assert.equal((await c.call(name, {})).why, "tool_not_allowed", name);
  }
  assert.throws(() => createMcpClient({ origin: "https://mcp.runwayml.com.evil.example", token: async () => ({}), check: checkRwOrigin }), /origin must be/);
});

test("a first answer is a quote only when it is plainly one", () => {
  const q = (o, plain) => readFirstAnswer(o, plain);
  assert.deepEqual(q({ status: QUOTE_MARK, credits: 12, costApproval: "ca_1" }), { kind: "quote", credits: 12, approval: "ca_1" });
  assert.deepEqual(q({ result: { code: QUOTE_MARK, quote: { creditCost: "12", costApproval: "ca_1" } } }), { kind: "quote", credits: 12, approval: "ca_1" });
  assert.deepEqual(q({ [QUOTE_MARK]: true, estimatedCredits: 7, costApproval: "ca_1", taskId: null }), { kind: "quote", credits: 7, approval: "ca_1" });
  // Not a whole number of at least one credit, or under a name with no unit: no quote (R5, finding 2).
  for (const bad of [{ credits: 0 }, { credits: 2.5 }, { estimatedCredits: "7.5" }, { credits: 1e-9 }, { price: 2.5 }, { price: 12 }, { amount: 12 },
    { cost: 12 }, { estimatedCost: 12 }, { estimated_cost: 12 }, { cost: { amount: 12 } }]) {
    assert.deepEqual(q({ status: QUOTE_MARK, costApproval: "ca_1", ...bad }), { kind: "refused" }, JSON.stringify(bad));
  }
  assert.deepEqual(q({ status: QUOTE_MARK, costApproval: "ca_1", cost: { credits: 12 } }), { kind: "quote", credits: 12, approval: "ca_1" }, "credits inside a cost object");
  // A task named anywhere: it started. Never a quote, whatever else it says.
  assert.deepEqual(q({ status: QUOTE_MARK, credits: 12, costApproval: "ca_1", taskId: "t-1" }), { kind: "started", taskId: "t-1" });
  assert.deepEqual(q({ taskId: "abc-123", status: "PENDING" }), { kind: "started", taskId: "abc-123" });
  assert.deepEqual(q({ id: "abc-123", status: "PENDING" }), { kind: "started", taskId: "abc-123" });
  assert.deepEqual(q({ tasks: [{ id: "a" }, { id: "b" }] }), { kind: "started", taskId: null }, "two tasks: started, and no one id");
  // Marked, but not a usable quote: nothing started, nothing approved.
  assert.deepEqual(q({ status: QUOTE_MARK, costApproval: "ca_1" }), { kind: "refused" }, "no credit count");
  assert.deepEqual(q({ status: QUOTE_MARK, credits: 12, estimatedCredits: 30, costApproval: "ca_1" }), { kind: "refused" }, "two counts");
  assert.deepEqual(q({ status: QUOTE_MARK, credits: 12, costApproval: "ca_1", quote: { costApproval: "ca_2" } }), { kind: "refused" }, "two approvals");
  assert.deepEqual(q({ status: QUOTE_MARK, credits: -1, costApproval: "ca_1" }), { kind: "refused" });
  assert.deepEqual(q({ status: QUOTE_MARK, credits: 12, costApproval: "has space" }), { kind: "refused" });
  assert.deepEqual(q(null, `${QUOTE_MARK}: 12 credits. costApproval ca_1`), { kind: "refused" }, "words are never read as a price");
  // Neither.
  assert.deepEqual(q({}), { kind: "unclear" });
  assert.deepEqual(q({ credits: 12, costApproval: "ca_1" }), { kind: "unclear" }, "no mark");
  assert.deepEqual(q(null, "Something happened."), { kind: "unclear" });
});

test("quote: the first call carries no approval; started and unclear answers are never accepted and are not clear", async () => {
  const answers = [
    [ok({ status: QUOTE_MARK, credits: 12, costApproval: "ca_1" }), { ok: true, credits: 12, approval: "ca_1" }],
    [{ ok: false, why: "tool_error", sent: true, status: 200, text: "x", refusal: { status: QUOTE_MARK, credits: 9, costApproval: "ca_9" }, plain: "" },
      { ok: true, credits: 9, approval: "ca_9" }],
    [ok({ taskId: "t-1" }), { ok: false, why: "started", taskId: "t-1", text: "", clear: false }],
    [ok({}), { ok: false, why: "unclear", text: "", clear: false }],
    [{ ok: false, why: "no_result", sent: true, status: 200, text: "", plain: "Done." }, { ok: false, why: "unclear", text: "", clear: false }],
    [ok({ status: QUOTE_MARK }), { ok: false, why: "no_quote", text: "", clear: true }],
    [{ ok: false, why: "tool_error", sent: true, status: 200, text: "Not available.", refusal: null, plain: "Not available." }, { ok: false, why: "tool_error", text: "Not available.", clear: true }],
    [{ ok: false, why: "network", sent: true, status: null, text: "" }, { ok: false, why: "network", text: "", clear: false }],
    [{ ok: false, why: "status", sent: true, status: 403, text: "" }, { ok: false, why: "status", text: "", clear: true }],
    [{ ok: false, why: "signed_out", sent: false, status: null, text: "" }, { ok: false, why: "signed_out", text: "", clear: true }],
  ];
  for (const [answer, want] of answers) {
    const m = fakeMcp(() => answer);
    const tools = createRunwayMcp({ mcp: m, net: deadNet });
    assert.deepEqual(await tools.quote(TURBO, clip), want, JSON.stringify(answer));
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].name, "generate_video");
    assert.equal(Object.hasOwn(m.calls[0].args, "costApproval"), false);
  }
});

test("the arguments: the row's model, the ratio in its words, the seconds, the first frame, count 1, confirmRepeat always", async () => {
  const m = fakeMcp(() => ok({ status: QUOTE_MARK, credits: 1, costApproval: "a" }));
  const tools = createRunwayMcp({ mcp: m, net: deadNet });
  await tools.quote(TURBO, clip);
  assert.deepEqual(m.calls[0].args, { model: "gen-4-turbo", promptText: "a slow push in", ratio: "16:9", duration: 5, startFrame: { url: "https://cdn.example/a.png" }, confirmRepeat: true });
  await tools.quote(IMAGE, { kind: "still_variation", prompt: "p", ratio: "1:1", seconds: null, assets: [{ url: "https://a.example/1.png", role: "ref" }, { url: "https://a.example/2.png", role: "ref" }] });
  assert.deepEqual(m.calls[1].args, { model: "gen-4", promptText: "p", ratio: "1:1", count: 1,
    referenceImages: [{ url: "https://a.example/1.png", tag: "ref1" }, { url: "https://a.example/2.png", tag: "ref2" }], confirmRepeat: true });
  // Anything the row does not name never reaches the arguments, and nothing is called.
  for (const bad of [{ ...clip, seconds: 7 }, { ...clip, ratio: "2:1" }, { ...clip, kind: "text_to_video" }, { ...clip, assets: [{ url: "http://x/a.png", role: "first" }] },
    { ...clip, prompt: "x".repeat(1001) }]) {
    const r = await tools.quote(TURBO, bad);
    assert.equal(r.ok, false);
    assert.equal(r.clear, true);
  }
  assert.equal(m.calls.length, 2);
  // Gen-4.5 from words alone takes 16:9 only; from a first frame, 9:16 too (R5).
  const g45 = accountRowFor("gen4.5");
  const words = { kind: "text_to_video", prompt: "p", ratio: "9:16", seconds: 5, assets: [] };
  assert.deepEqual([(await tools.quote(g45, words)).why, m.calls.length], ["not_the_rows", 2]);
  await tools.quote(g45, { ...words, ratio: "16:9" });
  await tools.quote(g45, { ...clip, ratio: "9:16" });
  assert.deepEqual(m.calls.slice(2).map((c) => c.args.ratio), ["16:9", "9:16"]);
});

test("start: the approval is sent with the same arguments; a second quote is quote_again (clear); a task is taken; anything else is not clear", async () => {
  const cases = [
    [ok({ taskId: "t-9", status: "PENDING" }), { ok: true, taskId: "t-9", credits: null }],
    [ok({ taskId: "t-9", credits: 14 }), { ok: true, taskId: "t-9", credits: 14 }],
    [ok({ status: QUOTE_MARK, credits: 30, costApproval: "ca_2" }), { ok: false, why: "quote_again", text: "", clear: true }],
    [ok({}), { ok: false, why: "no_task_id", text: "", clear: false }],
    [ok({ taskId: "bad id!" }), { ok: false, why: "bad_task_id", text: "", clear: false }],
    [{ ok: false, why: "tool_error", sent: true, status: 200, text: "No.", refusal: null, plain: "No." }, { ok: false, why: "tool_error", text: "No.", clear: true }],
    [{ ok: false, why: "network", sent: true, status: null, text: "" }, { ok: false, why: "network", text: "", clear: false }],
  ];
  for (const [answer, want] of cases) {
    const m = fakeMcp(() => answer);
    const tools = createRunwayMcp({ mcp: m, net: deadNet });
    assert.deepEqual(await tools.start(TURBO, clip, "ca_1"), want, JSON.stringify(answer));
    assert.equal(m.calls[0].args.costApproval, "ca_1");
    assert.equal(m.calls[0].args.model, "gen-4-turbo");
  }
  const m = fakeMcp(() => ok({}));
  assert.equal((await createRunwayMcp({ mcp: m, net: deadNet }).start(TURBO, clip, "bad approval")).why, "bad_approval");
  assert.equal(m.calls.length, 0);
});

test("task: Runway's statuses read tolerantly; another task's answer is unknown; a safety failure is refused", async () => {
  const read = async (answer) => createRunwayMcp({ mcp: fakeMcp(() => answer), net: deadNet }).task("t-1");
  assert.deepEqual(await read(ok({ id: "t-1", status: "SUCCEEDED", output: ["https://cdn.example/o.mp4"] })),
    { ok: true, url: "https://cdn.example/o.mp4", cost: null, costZero: false, reason: "", state: "done" });
  assert.equal((await read(ok({ task: { id: "t-1", status: "RUNNING" } }))).state, "working");
  assert.equal((await read(ok({ id: "t-1", status: "THROTTLED" }))).state, "working");
  assert.equal((await read(ok({ id: "t-1", status: "FAILED", failureCode: "SAFETY.INPUT.IMAGE" }))).state, "refused");
  assert.equal((await read(ok({ id: "t-1", status: "FAILED", failure: "Internal." }))).state, "failed");
  assert.equal((await read(ok({ id: "t-2", status: "SUCCEEDED", output: ["https://x/o.mp4"] }))).state, "unknown");
  assert.equal((await read(ok({ id: "t-1", status: "odd" }))).state, "unknown");
  assert.deepEqual([(await read(ok({ id: "t-1", status: "FAILED", credits: 0 }))).costZero], [true]);
  assert.equal((await createRunwayMcp({ mcp: fakeMcp(() => ok({})), net: deadNet }).task("../x")).why, "bad_task_id");
});

test("upload with no host pinned: one init_upload, the offered host logged, no bytes sent anywhere", async () => {
  const lines = [];
  const m = fakeMcp(() => ok({ uploadId: "u1", uploadUrls: ["https://storage.example-upload.test/u1/part-1?partNumber=1"] }));
  const tools = createRunwayMcp({ mcp: m, net: deadNet, log: (l) => lines.push(l) });
  const r = await tools.upload({ type: "image/png", bytes: Buffer.alloc(600, 1) });
  assert.deepEqual(r, { ok: false, why: "upload_host_unknown" });
  assert.deepEqual(m.calls.map((c) => c.name), ["init_upload"]);
  assert.deepEqual(m.calls[0].args, { filename: "input.png", fileSize: 600, mimeType: "image/png" });
  assert.deepEqual(lines, ["runway upload host offered and not pinned: storage.example-upload.test"]);
});

test("upload with a host pinned: a look-alike host, http, a port, user info or a dot path is refused before any byte goes", async () => {
  const suffixes = ["upload.runway-account.test"];
  for (const [url, why] of [
    ["https://upload.runway-account.test.evil.example/u/p?partNumber=1", "upload_host"],
    ["https://xupload.runway-account.test/u/p", "upload_host"],
    ["https://evil.example/upload.runway-account.test/u/p", "upload_host"],
    ["http://upload.runway-account.test/u/p", "upload_address"],
    ["https://upload.runway-account.test:8443/u/p", "upload_address"],
    ["https://me@upload.runway-account.test/u/p", "upload_address"],
    ["https://upload.runway-account.test/u/../p", "upload_address"],
    ["https://upload.runway-account.test/u/p#x", "upload_address"],
    ["https://upload.runway-account.test/u/p?a=1&a=2", "upload_address"],
  ]) {
    assert.equal(checkRwUploadAddress(url, suffixes).why, why, url);
    const m = fakeMcp(() => ok({ uploadId: "u1", uploadUrls: [url] }));
    const r = await createRunwayMcp({ mcp: m, net: deadNet, uploadSuffixes: suffixes }).upload({ type: "image/png", bytes: Buffer.alloc(600, 1) });
    assert.equal(r.why, why, url);
    assert.deepEqual(m.calls.map((c) => c.name), ["init_upload"]);
  }
  assert.equal(checkRwUploadAddress("https://a.upload.runway-account.test/up/x/part-1?partNumber=1&X-Amz-Signature=0a", suffixes).ok, true);
  const two = fakeMcp(() => ok({ uploadId: "u1", uploadUrls: ["https://upload.runway-account.test/a", "https://upload.runway-account.test/b"] }));
  assert.equal((await createRunwayMcp({ mcp: two, net: deadNet, uploadSuffixes: suffixes }).upload({ type: "image/png", bytes: Buffer.alloc(600, 1) })).why, "upload_parts");
});

test("balance: whoami's credits, or null when it gives none; never another tool", async () => {
  const m = fakeMcp(() => ok({ authenticated: true, credits: { unlimited: false, plan: 0, purchased: 14463, total: 14463 } }));
  assert.deepEqual(await createRunwayMcp({ mcp: m, net: deadNet }).balance(), { ok: true, credits: 14463 });
  assert.deepEqual(m.calls, [{ name: "whoami", args: {} }]);
  assert.deepEqual(await createRunwayMcp({ mcp: fakeMcp(() => ok({ authenticated: true })), net: deadNet }).balance(), { ok: true, credits: null });
  assert.equal((await createRunwayMcp({ mcp: fakeMcp(() => ok({ authenticated: false })), net: deadNet }).balance()).why, "unauthorized");
});

test("every account row names a tool of the list and a ceiling or none", () => {
  for (const row of ACCOUNT_ROWS) {
    assert.ok(RW_TOOLS.includes(row.tool), row.id);
    assert.ok(row.ceiling === null || row.ceiling.credits > 0, row.id);
  }
});
