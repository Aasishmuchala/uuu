// PLAN-V5 K15's owner part and K16's last bullet (T52): the sites an agent built for a task, the home server's own
// pictures of them, the owner's preview and the zip, and the page viewer's Test.
//   GET  /api/tasks/:id/sites                 each site with its files, pages and pictures; pictures are asked for
//                                             in the background for a site with none while the switch is on
//   POST /api/tasks/:id/sites/:ref/shots      take its pictures again (202); refused while the switch is off
//   POST /api/tasks/:id/sites/:ref/preview    load it into the owner's preview -> { url } (the home's own address)
//   GET  /api/tasks/:id/sites/:ref/zip        the site as a zip of its checked files
//   GET  /api/sites/shot/:key/:name           one kept picture, as a PNG that can run nothing
//   POST /api/viewer/test                     the home server's own test page through the viewer (C17: whatever
//                                             the switch)
// A `ref` is only ever matched against the task's own list of sites (lib/siteshots.mjs); every file is read with the
// viewer's rules; nothing an agent wrote is answered but its own checked files (the zip) and the home server's
// sentences and pictures. Every POST is the owner's same-origin call (the core refuses any other).
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { writeTar } from "../../../viewer/tar.mjs";
import { writeZip } from "../../../viewer/zip.mjs";
import { callDoor } from "../lib/doors.mjs";
import {
  SAY, findSite, kitFacts, readShot, readSite, requestShots, shotsView, siteInfo, sitesOf, takeShots, testViewer, viewerOn,
} from "../lib/siteshots.mjs";
import { fileResponse } from "../lib/static.mjs";
import { findTask, loadTaskContext } from "../lib/tasks.mjs";
import { kindOfTask } from "./pieces.mjs";

const SANDBOX = "default-src 'none'; sandbox";
const PREVIEW_ADDRESS = /^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export const VIEWER_SAY = Object.freeze({
  viewerOff: "The page viewer is off. Switch it on in Settings.",
  notRunning: "The page viewer is not running, so no pictures can be taken now.",
  previewOff: "The preview is not running. Run: engine start",
  previewRefused: "The preview did not take this site.",
  testOff: "The page viewer is off. Run: engine start",
});

// The home server's own test page (never anything an agent made): neutral colours and a face of this Mac.
export const TEST_SITE = Object.freeze([
  {
    name: "index.html",
    data: Buffer.from([
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "<meta charset=\"utf-8\">",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
      "<title>Page viewer test</title>",
      "<link rel=\"stylesheet\" href=\"style.css\">",
      "</head>",
      "<body>",
      "<main>",
      "<h1>Page viewer test</h1>",
      "<p>This page is built into the engine. Nothing an agent made is on it.</p>",
      "<p>If you can read this in a picture, Chrome opened it on this Mac and took the picture.</p>",
      "</main>",
      "</body>",
      "</html>",
      "",
    ].join("\n")),
  },
  {
    name: "style.css",
    data: Buffer.from([
      "html { background: #F4F4F4; color: #222222; }",
      "body { margin: 0; font-family: -apple-system, \"Helvetica Neue\", Helvetica, sans-serif; }",
      "main { max-width: 40rem; margin: 0 auto; padding: 4rem 1.5rem; }",
      "h1 { font-size: 2.25rem; font-weight: 600; margin: 0 0 1.5rem; }",
      "p { font-size: 1.125rem; line-height: 1.6; margin: 0 0 1rem; color: #444444; }",
      "",
    ].join("\n")),
  },
]);

function installed(config) {
  try { return lstatSync(join(config.engineDir, "viewer", "READY")).isFile(); } catch { return false; }
}

// The viewer's own state: on, off, unhealthy or not installed. A null address (a stub home) is off; nothing is called.
async function viewerState(ctx) {
  const r = await callDoor(ctx, "viewer", "/view/health", null, { auth: false, timeoutMs: 1000, maxBytes: 4096 });
  if (r.ok) return r.status === 200 && obj(r.json) && r.json.part === "viewer" ? "on" : "unhealthy";
  if (r.reason === "cut") return "unhealthy";
  if (r.reason === "no_address") return "off";
  return installed(ctx.config) ? "off" : "not_installed";
}

async function taskOf(ctx) {
  const tctx = await loadTaskContext(ctx, { withInbox: false, withComments: false });
  const goal = findTask(tctx, ctx.params.id);
  if (!goal || typeof goal.identifier !== "string" || !IDENTIFIER.test(goal.identifier)) {
    throw ctx.fail(404, "There is no such task.", "Go back to Tasks and pick one from the list.", "task_not_found");
  }
  return goal;
}

// The listed site of the request's `ref`, or 404. A task whose job makes another kind of piece has no sites.
function siteOf(ctx, goal) {
  const kind = kindOfTask(ctx, goal);
  const site = kind && kind !== "page" ? null : findSite(ctx.config, goal.identifier, ctx.params.ref);
  if (!site) throw ctx.fail(404, "This task has no site of that name.", "Go back to the task and pick a site from its list.", "site_not_found");
  return site;
}

// The site's files, read now with the viewer's rules, or 409 with the plain reason.
function filesOf(ctx, goal, site) {
  const read = readSite(ctx.config, goal.identifier, site.rel);
  if (!read.ok) throw ctx.fail(409, read.sentence, "Ask for the site to be fixed, then try again.", "site_problem");
  return read;
}

// GET /api/tasks/:id/sites: { viewer: { on, state }, sites: [...], problem }.
export async function sitesView(ctx, goal) {
  const config = ctx.config;
  const on = viewerOn(config);
  const state = await viewerState(ctx);
  const out = { viewer: { on, state }, sites: [], problem: null };
  const kind = kindOfTask(ctx, goal);
  if (kind && kind !== "page") return out;
  const listed = sitesOf(config, goal.identifier);
  if (listed.problem) return { ...out, problem: kind === "page" ? listed.problem : null };
  const kit = kitFacts(config);
  for (const s of listed.sites) {
    const info = siteInfo(config, goal.identifier, s.rel);
    let shots = shotsView(config, info, { on, kit });
    if (shots.state === "none") {
      if (state === "on" && requestShots(ctx, goal.identifier, s.ref)) shots = { ...shots, state: "working", sentence: SAY.working };
      else if (state !== "on") shots = { ...shots, sentence: VIEWER_SAY.notRunning };
    }
    out.sites.push({
      ref: s.ref, variant: s.variant, direction: s.direction,
      files: info.files, bytes: info.bytes, left: info.left, pages: info.pages, problem: info.problem,
      shots,
    });
  }
  return out;
}

export default function register(app) {
  app.get("/api/tasks/:id/sites", async (ctx) => sitesView(ctx, await taskOf(ctx)));

  app.post("/api/tasks/:id/sites/:ref/shots", async (ctx) => {
    const goal = await taskOf(ctx);
    const site = siteOf(ctx, goal);
    if (!viewerOn(ctx.config)) throw ctx.fail(409, VIEWER_SAY.viewerOff, "Open Settings.", "viewer_off");
    takeShots(ctx, goal.identifier, site.ref).catch(() => {});
    return { status: 202, body: { state: "working", sentence: SAY.working } };
  });

  app.post("/api/tasks/:id/sites/:ref/preview", async (ctx) => {
    const goal = await taskOf(ctx);
    const site = siteOf(ctx, goal);
    const read = filesOf(ctx, goal, site);
    const base = ctx.home?.urls?.preview;
    const r = await callDoor(ctx, "preview", "/preview/load", writeTar(read.files), { type: "application/x-tar" });
    if (!r.ok || typeof base !== "string" || !PREVIEW_ADDRESS.test(base)) throw ctx.fail(409, VIEWER_SAY.previewOff, "Then try again.", "preview_off");
    if (r.status !== 200) throw ctx.fail(409, VIEWER_SAY.previewRefused, "Ask for the site to be fixed, then try again.", "preview_refused");
    // The address is the home's own, never the preview's answer.
    return { url: `${base}/` };
  });

  app.get("/api/tasks/:id/sites/:ref/zip", async (ctx) => {
    const goal = await taskOf(ctx);
    const site = siteOf(ctx, goal);
    const read = filesOf(ctx, goal, site);
    const zip = writeZip(read.files);
    return fileResponse({ bytes: zip, size: zip.length, type: "application/zip" }, {
      "content-disposition": `attachment; filename="${goal.identifier}-${site.ref}.zip"`,
      "x-content-type-options": "nosniff", "cache-control": "no-store",
    });
  });

  app.get("/api/sites/shot/:key/:name", async (ctx) => {
    const data = readShot(ctx.config, ctx.params.key, ctx.params.name);
    if (!data) throw ctx.fail(404, "That picture is not here any more.", "Take the pictures again from the task's page.", "shot_not_found");
    return fileResponse({ bytes: data, size: data.length, type: "image/png" }, {
      "content-security-policy": SANDBOX, "x-content-type-options": "nosniff", "cache-control": "no-store",
    });
  });

  app.post("/api/viewer/test", async (ctx) => {
    const r = await testViewer(ctx, TEST_SITE.map((f) => ({ name: f.name, data: f.data })));
    const sentence = r.ok ? r.sentence : r.reason === "no_answer" ? VIEWER_SAY.testOff : r.reason === "no_chrome" ? SAY.noChrome : r.sentence;
    return { ok: r.ok, seconds: r.seconds, pictures: r.pictures, images: r.images, sentence };
  });
}
