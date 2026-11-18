// The guided setup in the shell (PLAN-ONBOARD T3): its address, the first-run opening from the bare address only,
// the sidebar's Setup row while the server says to show it, and Setup in the command menu at all times.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dom = await import("./kit/_dom.mjs");
const load = (p) => import(pathToFileURL(join(dom.PUBLIC, p)).href);
const routes = await load("routes.js");
const { setupRedirect } = await load("shell/app-shell.js");
const side = await load("shell/sidenav.js");
const menu = await load("shell/command-menu.js");
const { html, render } = dom;

test("setup: the address #/setup is its own page, in no section", () => {
  assert.equal(routes.findRoute(["setup"]).id, "setup");
  assert.equal(routes.findRoute(["setup", "x"]), null);
  assert.equal(routes.sectionOf("setup"), null);
  assert.equal(routes.routeById("setup").file, "./pages/setup.js");
  assert.equal(routes.routeById("setup").title, "Setup");
});

test("setup: only the bare address opens Setup, only when the server says open, once", () => {
  assert.equal(setupRedirect({ parts: [], setup: { open: true } }), "#/setup");
  assert.equal(setupRedirect({ parts: ["map"], setup: { open: true } }), null, "#/map always reaches the Map");
  assert.equal(setupRedirect({ parts: [], setup: { open: false } }), null);
  assert.equal(setupRedirect({ parts: [], setup: null }), null, "a failed or pending /api/setup sends nowhere");
  assert.equal(setupRedirect({ parts: [], setup: { open: true }, done: true }), null, "at most once per page load");
  assert.equal(setupRedirect({ parts: [], setup: { open: "yes" } }), null);
  assert.equal(setupRedirect({ parts: ["tasks"], setup: { open: true } }), null);
  assert.equal(setupRedirect({}), null);
});

test("setup: the sidebar's row says how many of five are done, and is there only while shown", () => {
  assert.deepEqual(side.setupItem({ show: true, counts: { done: 1, skipped: 1 } }),
    { href: "#/setup", icon: "check", title: "Setup", label: "Setup: 2 of 5 done", count: 3 });
  assert.equal(side.setupItem({ show: false, counts: { done: 1, skipped: 1 } }), null);
  assert.equal(side.setupItem(null), null);
  assert.equal(side.setupItem({ show: "true", counts: { done: 1 } }), null);
  assert.equal(side.setupItem({ show: true, counts: { done: "x" } }).label, "Setup: 0 of 5 done");
  assert.equal(side.setupItem({ show: true, counts: { done: 4, skipped: 9 } }).label, "Setup: 5 of 5 done", "clamped to 5");
  assert.equal(side.setupItem({ show: true, counts: { done: -3, skipped: 1.7 } }).label, "Setup: 1 of 5 done");
  assert.equal(side.setupItem({ show: true }).count, 5);
  assert.equal(side.sideCurrent("setup"), "setup");
});

function drawSide(props) {
  dom.installDom();
  const root = new dom.FakeElement("div");
  render(html`<${side.Sidenav} mode="open" routeId="map" parts=${[]} query=${new URLSearchParams("")}
    shell=${{ company: { name: "Sthyra" }, counts: { needsYou: 2 } }} dock=${[]} settings=${{ theme: "dark" }} onSaveSettings=${() => {}} ...${props} />`, root);
  return root;
}
const hrefs = (root) => dom.elements(root).map((e) => e.getAttribute("href") ?? e.href ?? null).filter(Boolean);

test("setup: the sidebar draws one Setup link while shown, under Needs you, and none otherwise", () => {
  const shown = drawSide({ setup: { show: true, counts: { done: 2, skipped: 0 } } });
  const links = hrefs(shown);
  assert.equal(links.filter((h) => h === "#/setup").length, 1);
  assert.deepEqual(links.slice(0, 4), ["#/map", "#/needs-you", "#/setup", "#/map"], "the brand, Needs you, then Setup");
  assert.equal(hrefs(drawSide({ setup: { show: false, counts: { done: 2 } } })).includes("#/setup"), false);
  assert.equal(hrefs(drawSide({})).includes("#/setup"), false);
  const current = drawSide({ routeId: "setup", setup: { show: true, counts: { done: 0 } } });
  const here = dom.elements(current).filter((e) => e.getAttribute("aria-current") === "page").map((e) => e.getAttribute("href"));
  assert.deepEqual(here, ["#/setup"]);
});

test("setup: the command menu lists Setup among its pages, whatever the setup's state", () => {
  const pages = menu.localItems("").filter((i) => i.group === "Pages");
  assert.equal(pages.filter((p) => p.label === "Setup").length, 1);
  assert.equal(pages.find((p) => p.label === "Setup").href, "#/setup");
  assert.equal(menu.localItems("setu").filter((p) => p.group === "Pages" && p.label === "Setup").length, 1);
});
