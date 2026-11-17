// The loft's pictures as the stage asks for them (the owner chose photographs over 3D on 18 Nov 2026): the owner's own
// generated pictures, made into WebP at 2560, 1600 and 900 px wide in assets/office/v1/ (its manifest.json lists each
// file with its size and SHA-256; test/office/assets.test.mjs pins them). Pure: no imports, no page.
//
// - picture: "loft" (the Map) or "desk" (Needs you); light: "dusk" (the dark theme) or "morning" (the light theme).
// - A phone (a stage under 860 px) is only ever given the 900 px file; a wider stage the 1600 and 2560 px files, the
//   browser choosing by the stage's width and the screen's density.
// - ground: 3 x 3 pixels the stage stretches under the picture (the loft's plain backdrop at its edges; the desk made
//   tiny), so the stage is lit in the picture's own colours before it arrives and where the frame does not reach.
// - The moving picture: a 5 second loop of the dusk loft may come later as loop-dusk.mp4. Until it is in v1/ and in
//   the manifest, VIDEO is null and no page asks for it. When it lands: set VIDEO to its path, add it to the manifest
//   and the test; the stage then lays it over the dusk still (muted, looped, its poster the still) on a desktop only,
//   never under reduced motion, and pauses it while the tab is hidden.

export const ASSET_DIR = "/assets/office/v1";
export const PICTURES = Object.freeze(["loft", "desk"]);
export const LIGHTS = Object.freeze(["dusk", "morning"]);
export const WIDTHS = Object.freeze([2560, 1600, 900]);
export const PHONE_WIDTH = 900;
export const PHONE_BELOW = 860;
export const VIDEO = null;

const pick = (v, list) => (list.includes(v) ? v : list[0]);

// The light for a theme: the light theme is the golden morning, every other the dusk.
export const lightOf = (theme) => (theme === "light" ? "morning" : "dusk");

// The path of one file: picturePath("loft", "dusk", 1600) -> "/assets/office/v1/loft-dusk-1600.webp".
export function picturePath(picture, light, width) {
  const w = WIDTHS.includes(width) ? width : 1600;
  return `${ASSET_DIR}/${pick(picture, PICTURES)}-${pick(light, LIGHTS)}-${w}.webp`;
}

export const groundPath = (picture, light) => `${ASSET_DIR}/${pick(picture, PICTURES)}-${pick(light, LIGHTS)}-ground.webp`;

// What the <img> gets: { src, srcset, sizes } for a tier ("phone" or "desktop"). The phone's is one file.
export function sourcesOf(picture, light, tier) {
  if (tier === "phone") {
    const src = picturePath(picture, light, PHONE_WIDTH);
    return { src, srcset: `${src} ${PHONE_WIDTH}w`, sizes: `${PHONE_WIDTH}px` };
  }
  const big = picturePath(picture, light, 2560);
  const mid = picturePath(picture, light, 1600);
  return { src: mid, srcset: `${mid} 1600w, ${big} 2560w`, sizes: "(min-width: 1700px) 2560px, 1600px" };
}

// The moving picture for a stage, or null: only the dusk loft, on a desktop, with motion allowed and a file to play.
export function videoOf({ picture, light, tier, still, video = VIDEO } = {}) {
  if (picture !== "loft" || light !== "dusk" || tier !== "desktop" || still === true) return null;
  return typeof video === "string" && /^\/assets\/office\/v\d+\/[a-z0-9-]+\.mp4$/.test(video) ? video : null;
}
