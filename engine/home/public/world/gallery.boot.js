// Draws the studio's stage full window from a named fixture (PLAN-3D T7), for the harness's pictures and for looking.
// Loaded as a module by gallery.html; no inline script. "?fixture=<name>" (a wrong or missing name shows the seed),
// "?mode=map|desk", "?focus=<room id>"; "?world=off" is read by the stage itself; "?theme=" and "?motion=" by
// lib/theme-boot.js before paint.
import { html, render } from "../vendor/preact-htm.js";
import { fixtures, FIXTURE_NAMES } from "./fixtures.js";
import { ID, worldState } from "./state.js";
import { WorldStage } from "./stage.js";

// What the address asks for: { fixture, mode, focus }, each checked.
export function galleryChoice(search) {
  let q;
  try { q = new URLSearchParams(typeof search === "string" ? search : ""); } catch { q = new URLSearchParams(""); }
  const name = q.get("fixture");
  const fixture = name && FIXTURE_NAMES.includes(name) ? name : "seed";
  const mode = q.get("mode") === "desk" ? "desk" : "map";
  const f = q.get("focus");
  return { fixture, mode, focus: f && ID.test(f) ? f : null };
}

function themeNow() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "light") return "light";
  if (t === "auto" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

const host = typeof document !== "undefined" && typeof document.getElementById === "function" ? document.getElementById("gallery") : null;
if (host) {
  const choice = galleryChoice(location.search);
  const state = worldState(fixtures[choice.fixture]);
  const still = document.documentElement.getAttribute("data-motion") === "off";
  render(html`<${WorldStage} mode=${choice.mode} state=${state} focus=${choice.focus} theme=${themeNow()} still=${still}
    label=${state.summary} onPick=${() => {}} />`, host);
}
