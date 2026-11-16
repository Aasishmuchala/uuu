// What the page can give the world (PLAN-3D D3, D6, T6 f): plain facts, read from the page or handed in, so the tests
// can ask the same questions in Node. No three.js here.
//
// canWorld(env?)  WebGL2 exists, the address does not carry `world=off`, the browser does not ask to save data.
// tierOf(width)   "phone" below 860 px of stage, else "desktop".
// stillOf(env?)   the root carries data-motion="off", or the system asks for reduced motion.
// benchOn(env?)   the page's query carries worldbench=1 (the measure's hook, 2.4).

export const PHONE_BELOW = 860;

// The address's query and the hash's query together: "?a=1&b=2#/map?c=3" reads as one list.
function queryOf(env) {
  if (env && typeof env.query === "string") return env.query;
  const loc = globalThis.location || {};
  const search = typeof loc.search === "string" ? loc.search : "";
  const hash = typeof loc.hash === "string" ? loc.hash : "";
  return `${search}&${hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : ""}`;
}

const has = (query, pair) => new RegExp(`(^|[?&#])${pair}(&|$|#)`).test(query);

export function canWorld(env) {
  const e = env && typeof env === "object" ? env : {};
  const g = globalThis;
  const webgl2 = "webgl2" in e ? e.webgl2 === true : typeof g.WebGL2RenderingContext === "function";
  const conn = g.navigator && g.navigator.connection;
  const saveData = "saveData" in e ? e.saveData === true : !!(conn && conn.saveData === true);
  return webgl2 && !has(queryOf(e), "world=off") && !saveData;
}

export function tierOf(width) {
  return Number.isFinite(width) && width < PHONE_BELOW ? "phone" : "desktop";
}

export function stillOf(env) {
  const e = env && typeof env === "object" ? env : {};
  if ("motion" in e || "reduced" in e) return e.motion === "off" || e.reduced === true;
  const g = globalThis;
  const root = g.document && g.document.documentElement;
  if (root && typeof root.getAttribute === "function" && root.getAttribute("data-motion") === "off") return true;
  return typeof g.matchMedia === "function" && g.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
}

export function benchOn(env) {
  return has(queryOf(env && typeof env === "object" ? env : {}), "worldbench=1");
}
