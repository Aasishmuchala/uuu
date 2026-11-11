// Writes the walker sprite of the version 2 seed into state-seed-v2/tasks/company-work/STH-8/art/walker/.
// Run once (node make-sprite-fixture.mjs); the output is committed. Built-in modules only, deterministic.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "state-seed-v2", "tasks", "company-work", "STH-8", "art", "walker");
const W = 16, H = 16, FRAMES = 4;
const DURATIONS = [120, 120, 120, 120];
const INK = [0x1b, 0x1b, 0x1f, 255], BODY = [0xf4, 0xa2, 0x61, 255], LEGS = [0xe7, 0x6f, 0x51, 255], SCARF = [0x2a, 0x9d, 0x8f, 255];
const CLEAR = [0, 0, 0, 0];

// One frame: a small round mascot, with the legs and the scarf moving from frame to frame.
function frame(n) {
  const px = Array.from({ length: H }, () => Array.from({ length: W }, () => CLEAR));
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y][x] = c; };
  const bob = n % 2; // the body lifts on frames 1 and 3
  for (let y = 3; y < 11; y++) for (let x = 4; x < 12; x++) {
    const corner = (x === 4 || x === 11) && (y === 3 || y === 10);
    if (!corner) set(x, y - bob, BODY);
  }
  set(6, 5 - bob, INK); set(9, 5 - bob, INK); // eyes
  for (let x = 5; x < 11; x++) set(x, 8 - bob, SCARF);
  set(11 + (n === 1 || n === 2 ? 1 : 0), 8 - bob, SCARF); set(12 + (n === 2 ? 1 : 0), 9 - bob, SCARF);
  const legs = [[[5, 11], [10, 12]], [[6, 11], [9, 11]], [[7, 11], [8, 12]], [[6, 12], [9, 11]]][n];
  for (const [x, y] of legs) { set(x, y, LEGS); set(x, y + 1, INK); }
  for (let x = 4; x < 12; x++) set(x, 14, INK); // the ground line
  return px;
}

const frames = Array.from({ length: FRAMES }, (_, n) => frame(n));

// ---- the sheet, a PNG of RGBA8 pixels, four frames side by side
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
  return out;
};
const sheetW = W * FRAMES;
const raw = Buffer.alloc((sheetW * 4 + 1) * H);
const count = new Map();
for (let y = 0; y < H; y++) {
  raw[y * (sheetW * 4 + 1)] = 0; // filter: none
  for (let f = 0; f < FRAMES; f++) for (let x = 0; x < W; x++) {
    const c = frames[f][y][x];
    Buffer.from(c).copy(raw, y * (sheetW * 4 + 1) + 1 + (f * W + x) * 4);
    if (c[3] === 255) { const hex = "#" + c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join(""); count.set(hex, (count.get(hex) || 0) + 1); }
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(sheetW, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
]);

// ---- the GIF: four 1 x 1 frames, built as the two-frame vector of CONTRACTS-V2 17.8 (a frame is 23 bytes)
const gifFrame = (data) => [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x02, 0x02, data, 0x01, 0x00];
const gif = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00,
  0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 0x03, 0x01, 0x00, 0x00, 0x00, // loop forever
  ...[0x44, 0x4c, 0x44, 0x4c].flatMap(gifFrame),
  0x3b,
]);

// ---- the data file (Aseprite json-array shape) and the manifest
const data = {
  frames: frames.map((_, n) => ({
    filename: `walker ${n}.png`, frame: { x: n * W, y: 0, w: W, h: H }, rotated: false, trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: W, h: H }, sourceSize: { w: W, h: H }, duration: DURATIONS[n],
  })),
  meta: {
    app: "uuu-engine", version: "1", image: "walker-sheet.png", format: "RGBA8888", size: { w: sheetW, h: H }, scale: "1",
    frameTags: [{ name: "walk", from: 0, to: 3, direction: "forward" }],
  },
};
const palette = [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([hex]) => hex);
const manifest = {
  name: "walker", title: "Mascot walk cycle", kind: "sprite", sheet: "walker-sheet.png", data: "walker.json", gif: "walker.gif",
  frames: FRAMES, frameSize: { w: W, h: H }, tags: ["walk"], palette, script: "walker.py", made_at: "2026-11-11T08:30:00Z",
};
const script = `# The mascot's walk cycle: four frames of 16 x 16, tagged "walk".
from PIL import Image, ImageDraw

title = "Mascot walk cycle"
frames = []
for n in range(4):
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lift = n % 2
    d.rectangle([4, 3 - lift, 11, 10 - lift], fill="#f4a261")
    d.rectangle([5, 8 - lift, 10, 8 - lift], fill="#2a9d8f")
    d.point([(6, 5 - lift), (9, 5 - lift)], fill="#1b1b1f")
    frames.append(img)
durations = 120
tags = [{"name": "walk", "from": 0, "to": 3, "direction": "forward"}]
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "walker-sheet.png"), png);
writeFileSync(join(OUT, "walker.gif"), gif);
writeFileSync(join(OUT, "walker.json"), JSON.stringify(data, null, 2) + "\n");
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(OUT, "walker.py"), script);
console.log(`walker: ${FRAMES} frames of ${W} x ${H}, ${palette.length} colours. Wrote ${OUT}`);
