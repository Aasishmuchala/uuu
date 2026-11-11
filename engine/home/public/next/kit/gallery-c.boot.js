// Renders the new parts' gallery (gallery-c.js) into gallery-c.html. Loaded as a module; no inline script.
// "?accent=<name>" sets the accent for this visit; "?theme=", "?backdrop=" and "?motion=" are read by
// lib/theme-boot.js before paint. "?press=1" presses Start on the forms that show the states after a press.
//
// This page has no home server behind it: the job forms talk to a fake answer, set up here and only here.
import { html, render } from "../vendor/preact-htm.js";
import Gallery from "./gallery-c.js";

const params = new URLSearchParams(location.search);
const accent = params.get("accent");
if (accent && /^[a-z]+$/.test(accent)) document.documentElement.setAttribute("data-accent", accent);

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const GOAL = { id: "e0000000-0000-4000-8000-000000000031", identifier: "STH-31", title: "Write a first message to a lead: Asha Kitchens", state: "waiting", plainState: "Waiting to start" };
globalThis.fetch = async (path) => {
  const p = String(path);
  if (p.includes("/demo-sending/")) return new Promise(() => {});
  if (p.includes("/demo-refused/")) return json(409, { error: { code: "job_not_ready", message: "Fill in \"Brand\" first.", next: "Open Files and fill in the Brand form." } });
  if (p.includes("/demo-off/")) return json(502, { error: { code: "offline", message: "The board is not answering.", next: "Run: engine start" } });
  return json(201, { goal: GOAL, message: "Started. The Chief of staff has it. It takes a few minutes and is checked before it reaches you." });
};

render(html`<${Gallery} />`, document.getElementById("gallery"));

if (params.get("press") === "1") {
  setTimeout(() => {
    for (const form of document.querySelectorAll("[data-press] form")) form.requestSubmit();
  }, 50);
}
