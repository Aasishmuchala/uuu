// The world's files (PLAN-3D D9, D17, D20, T6 e): every texture, model and sky the world loads is named by a key of
// assets/world/v1/manifest.json and reached only through assetUrl(key), which refuses anything the manifest does not
// hold. A need is a plain key ("tex.wood_floor.diff", "sky.dusk.hdr", "model.fern_02"); the file is the one entry
// whose key is the need itself, or the need and one more part ("tex.wood_floor.diff.1k"), that serves the tier, the
// mode and the theme. Exactly one may match, or the need fails. No three.js here: this module fetches bytes and
// pictures, the world makes textures of them.

export const MANIFEST_PATH = "/assets/world/v1/manifest.json";
const FOLDER = "assets/world/v1/";
const KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const PATH = /^[a-z0-9_][a-z0-9_./-]*$/i;

let manifest = null;

// Use a manifest already read (the tests read it from disk; the page through loadManifest).
export function useManifest(m) {
  if (!m || typeof m !== "object" || !Array.isArray(m.files)) throw new Error("not a manifest");
  manifest = m;
  return m;
}

export async function loadManifest() {
  if (manifest) return manifest;
  const res = await fetch(MANIFEST_PATH, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  return useManifest(await res.json());
}

const fits = (f, { tier, mode, theme }) =>
  (!tier || f.tiers.includes(tier)) && (!mode || f.modes.includes(mode)) && (!theme || f.themes.includes(theme));

// The one manifest entry for a need, or a throw.
export function entryOf(key, where = {}) {
  if (typeof key !== "string" || !key || key.length > 80 || !KEY.test(key)) throw new Error("not an asset key");
  if (!manifest) throw new Error("the manifest is not read");
  const w = { tier: where.tier || "desktop", mode: where.mode || null, theme: where.theme || null };
  const files = manifest.files.filter((f) => f && typeof f.key === "string" && Array.isArray(f.tiers) && Array.isArray(f.modes) && Array.isArray(f.themes));
  let found = files.filter((f) => f.key === key && fits(f, w));
  if (!found.length) {
    const depth = key.split(".").length + 1;
    found = files.filter((f) => f.key.startsWith(`${key}.`) && f.key.split(".").length === depth && fits(f, w));
  }
  if (found.length !== 1) throw new Error(`asset ${key}: ${found.length} files fit`);
  const f = found[0];
  if (typeof f.path !== "string" || !f.path.startsWith(FOLDER) || f.path.includes("..") || !PATH.test(f.path)) throw new Error(`asset ${key}: a path outside the set`);
  return f;
}

// The address of a need's file, from the site's root.
export function assetUrl(key, where) {
  return `/${entryOf(key, where).path}`;
}

// Every manifest entry of a model (the .gltf, its .bin and its pictures): they share the key's prefix.
export function familyOf(key, where = {}) {
  const w = { tier: where.tier || "desktop", mode: where.mode || null, theme: where.theme || null };
  return manifest ? manifest.files.filter((f) => (f.key === key || f.key.startsWith(`${key}.`)) && fits(f, w)) : [];
}

// The bytes of everything a tier, mode and theme load (vendor files left out: they are loaded by then).
export function bytesOf(where) {
  if (!manifest) return 0;
  return manifest.files.filter((f) => typeof f.path === "string" && f.path.startsWith(FOLDER) && fits(f, where)).reduce((s, f) => s + (f.bytes | 0), 0);
}

// Fetch helpers: same origin, no cookies sent anywhere else, a failed answer throws.
async function get(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`asset ${res.status}`);
  return res;
}
export async function fetchBytes(key, where) {
  return (await get(assetUrl(key, where))).arrayBuffer();
}
export async function fetchJson(key, where) {
  return (await get(assetUrl(key, where))).json();
}
// A picture decoded off the page's thread, never through an <img> or a blob: address (the policy's img-src).
export async function fetchPicture(key, where, { flipY = true } = {}) {
  const blob = await (await get(assetUrl(key, where))).blob();
  return createImageBitmap(blob, { imageOrientation: flipY ? "flipY" : "none", colorSpaceConversion: "none", premultiplyAlpha: "none" });
}
