// The room header and the lamp (PLAN-3D-ALL D6, U2). A surface screen's header is a band at the top of the page
// column: one baked photograph of the part of the studio the page belongs to, a scrim, and over the scrim what
// PageHeader draws (the one h1#page-title, the lede, the state, the actions; the crumbs go to the top bar).
// The picture never shows state and is hidden from readers. Its address comes only from a fixed table of keys:
// no server text ever reaches it. No picture when the browser asks to save data, when the address holds
// glimpse=off, or once it fails to load: the band then shows its material alone and keeps its height.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { usePageHeader } from "./page.js";
import { cx } from "./util.js";

const DEPTS = ["operations", "sales", "marketing", "studio", "support", "people", "books"];
// Every key a picture exists for (PLAN-3D-ALL D7). Frozen: nothing adds to it at run time.
export const GLIMPSES = Object.freeze(["desk", "shelves", "annex", "terrace", "table", "facade", "room", ...DEPTS.map((d) => `room-${d}`)]);
// The record dashboards' rooms: customers live in Sales.
const BOARDS = Object.freeze({ books: "room-books", customers: "room-sales", support: "room-support", people: "room-people" });
// A route's own key; a function takes the route's hint (a department or a dashboard).
const ROUTES = Object.freeze({
  tasks: "desk",
  task: (h) => room(h) || "desk",
  dashboards: "facade",
  dashboard: (h) => (typeof h === "string" && Object.hasOwn(BOARDS, h) ? BOARDS[h] : "facade"),
  marketing: "room-marketing",
  studio: "table",
  files: "shelves",
  jobs: "table",
  job: (h) => room(h) || "table",
  dept: (h) => room(h) || "room",
  team: "facade",
  agent: "desk",
  routines: "facade",
  health: "facade",
  settings: "facade",
  search: "shelves",
  apps: "terrace",
  // The scenes and an app's frame have no band.
  app: null,
  map: null,
  "needs-you": null,
});

function room(h) {
  return typeof h === "string" && DEPTS.includes(h) ? `room-${h}` : null;
}

// The key of a route's picture, or null for a route with no band. A route or hint not in the tables gives the
// generic room.
export function glimpseFor(routeId, hint) {
  if (typeof routeId !== "string" || !Object.hasOwn(ROUTES, routeId)) return "room";
  const at = ROUTES[routeId];
  return typeof at === "function" ? at(hint) : at;
}

// The picture's address for a key, or null for anything not in the table. Dusk in the dark theme, morning in the
// light one; the 780 px file below 860 px of width, else the 1600 px one.
export function glimpseSrc(key, { theme, width } = {}) {
  if (typeof key !== "string" || !GLIMPSES.includes(key)) return null;
  const light = theme === "light" ? "morning" : "dusk";
  const size = typeof width === "number" && width < 860 ? 780 : 1600;
  return `./assets/glimpse/v1/${key}-${light}-${size}.webp`;
}

// The theme in force: "light" when chosen, or when "auto" and the Mac is light; else "dark".
function themeNow() {
  if (typeof document === "undefined" || !document.documentElement) return "dark";
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "light") return "light";
  if (t === "auto" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

const widthNow = () => (typeof innerWidth === "number" ? innerWidth : 1280);

// True when no picture should be asked for at all.
function pictureOff() {
  if (typeof navigator !== "undefined" && navigator.connection && navigator.connection.saveData === true) return true;
  if (typeof location !== "undefined" && /[?&#]glimpse=off(?:[&#]|$)/.test(String(location.href || ""))) return true;
  return false;
}

// Follows the theme and the window's width class, so the band swaps its picture when either changes.
function useLook() {
  const read = () => ({ theme: themeNow(), width: widthNow() < 860 ? 780 : 1600 });
  const [look, setLook] = useState(read);
  useEffect(() => {
    const again = () => {
      const next = read();
      setLook((was) => (was.theme === next.theme && was.width === next.width ? was : next));
    };
    const root = typeof document !== "undefined" ? document.documentElement : null;
    const watch = root && typeof MutationObserver === "function" ? new MutationObserver(again) : null;
    if (watch) watch.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const mac = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
    if (mac && mac.addEventListener) mac.addEventListener("change", again);
    if (typeof addEventListener === "function") addEventListener("resize", again);
    return () => {
      if (watch) watch.disconnect();
      if (mac && mac.removeEventListener) mac.removeEventListener("change", again);
      if (typeof removeEventListener === "function") removeEventListener("resize", again);
    };
  }, []);
  return look;
}

// PageHeader's props plus `glimpse` (a key of GLIMPSES; anything else draws the band without a picture).
export function RoomHeader({ glimpse, ...props }) {
  const body = usePageHeader(props);
  const look = useLook();
  const [failed, setFailed] = useState(null);
  const key = typeof glimpse === "string" && GLIMPSES.includes(glimpse) ? glimpse : null;
  const src = key && !pictureOff() ? glimpseSrc(key, look) : null;
  const show = src && failed !== src;
  return html`<header class=${cx("k-room", !show && "k-room--bare")} data-glimpse=${key || "none"}>
    <div class="k-room__band" aria-hidden="true">
      ${show
        ? html`<img class="k-room__img" src=${src} alt="" aria-hidden="true" decoding="async" onError=${() => setFailed(src)} />`
        : null}
      <div class="k-room__scrim"></div>
    </div>
    <div class="k-room__head">${body}</div>
  </header>`;
}

// The lamp glyph of the Map's list (PLAN-3D D7) as a kit part. Each state has its own shape as well as its
// colour: on a disc, amber a disc in a ring, red a thick ring, off a hollow ring, down a low line. Hidden from
// readers unless it has a label; the words beside it usually say the state.
const LAMP_SHAPES = Object.freeze({ on: "disc", amber: "halo", red: "ring", off: "hollow", down: "line" });

export function Lamp({ state, label }) {
  const at = typeof state === "string" && Object.hasOwn(LAMP_SHAPES, state) ? state : "off";
  const named = typeof label === "string" && label !== "";
  return html`<span
    class=${`k-lamp k-lamp--${at} k-lamp--${LAMP_SHAPES[at]}`}
    role=${named ? "img" : undefined}
    aria-label=${named ? label : undefined}
    aria-hidden=${named ? undefined : "true"}
  ></span>`;
}
