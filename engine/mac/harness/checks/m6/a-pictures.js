// (a) Pictures: every <img> on the page decodes (img.decode()), with its address and natural size; the stage's
// CSS background pictures load; the room header's picture (kit/room.js) is assets/glimpse/v2 WebP; WebGL contexts
// are counted by the probe itself. INJ.wait: a selector to wait for first (the Map's [data-office=ready]).
if (INJ.wait) await waitFor(INJ.wait, 30000);
await quiet(8000);
const imgs = [];
for (const img of document.images) {
  const src = img.currentSrc || img.getAttribute("src") || "";
  if (!src) continue;
  let decoded = true; let why = null;
  try { await img.decode(); } catch (e) { decoded = false; why = String(e && e.name || e); }
  imgs.push({ src: src.replace(location.origin, "").slice(0, 200), cls: label(img), w: img.naturalWidth, h: img.naturalHeight, decoded: decoded && img.naturalWidth > 0, why });
}
const bgs = [];
for (const e of document.querySelectorAll(".o-stage, .o-stage *, .k-room, .k-room *")) {
  const bg = getComputedStyle(e).backgroundImage;
  for (const m of String(bg).matchAll(/url\("?([^")]+)"?\)/g)) {
    const u = m[1];
    const ok = await new Promise((r) => { const i = new Image(); i.onload = () => r(i.naturalWidth > 0); i.onerror = () => r(false); i.src = u; });
    bgs.push({ url: u.replace(location.origin, "").slice(0, 200), on: label(e), ok });
  }
}
const room = document.querySelector(".k-room__img");
return {
  path: location.pathname + location.search + location.hash,
  officeReady: document.querySelector("[data-office]")?.getAttribute("data-office") ?? null,
  stageImgs: imgs.filter((i) => /o-(img|ground)|office/.test(i.cls + i.src)),
  imgs, broken: imgs.filter((i) => !i.decoded), bgs, bgBroken: bgs.filter((b) => !b.ok),
  zones: document.querySelectorAll("[data-zone]").length,
  room: room ? { src: (room.currentSrc || room.src).replace(location.origin, ""), w: room.naturalWidth, h: room.naturalHeight,
    webpV2: /\/assets\/glimpse\/v2\/[a-z-]+-(dusk|morning)-(780|1600)\.webp$/.test(room.currentSrc || room.src) } : null,
  roomBand: document.querySelector(".k-room")?.getAttribute("data-glimpse") ?? null,
};
