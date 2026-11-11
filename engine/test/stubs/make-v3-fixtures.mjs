// Writes the picture and video files of the version 3 seed (CONTRACTS-V3 section 38) into state-seed/.
// Run once (node make-v3-fixtures.mjs); the output is committed. Built-in modules only; the PNGs are
// flat colours made with node:zlib, the one MP4 is made by ffmpeg from its own test source.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const SEED = join(here, "state-seed");
const WORK = join(SEED, "tasks", "company-work");
const FFMPEG = "/opt/homebrew/bin/ffmpeg";

// ---- a PNG of RGB8 pixels from a function (x, y) -> [r, g, b]
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
  return out;
};
function png(w, h, colourAt) {
  const row = w * 3 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = colourAt(x, y);
      const p = y * row + 1 + x * 3;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const write = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); };

// A slide: a flat background, a band of the accent colour and a block where the words would be.
const SLIDES = [["#1f3a34", "#e8b04a"], ["#f4efe6", "#1f3a34"], ["#e8b04a", "#1f3a34"]];
const slide = ([bg, accent], scale = 1) => (x, y) => {
  const [X, Y] = [x / scale, y / scale];
  if (Y >= 1150 && Y < 1190) return hex(accent);
  if (X >= 120 && X < 960 && Y >= 300 && Y < 520) return hex(accent);
  return hex(bg);
};

// ---- STH-24: three 1080 x 1350 slides and the contact sheet (all three side by side, 2160 px wide)
const launch = join(WORK, "STH-24", "slides", "launch");
SLIDES.forEach((c, n) => write(join(launch, `slide-0${n + 1}.png`), png(1080, 1350, slide(c))));
write(join(launch, "contact.png"), png(2160, 900, (x, y) => slide(SLIDES[Math.floor(x / 720)], 720 / 1080)(x % 720, y)));

// ---- the company brain's sample picture
write(join(SEED, "knowledge", "docs", "references", "sample.png"), png(64, 48, (x, y) => (y < 30 ? hex("#c9d8c5") : hex(x < 32 ? "#7a5c3e" : "#a07850"))));

// ---- STH-25: a one-second 320 x 180 MP4, its poster and six stills
const title = join(WORK, "STH-25", "video", "title");
mkdirSync(join(title, "review"), { recursive: true });
const mp4 = join(title, "title.mp4");
rmSync(mp4, { force: true });
execFileSync(FFMPEG, [
  "-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=1",
  "-c:v", "libx264", "-preset", "veryslow", "-crf", "36", "-pix_fmt", "yuv420p", "-an", "-map_metadata", "-1",
  "-fflags", "+bitexact", "-flags:v", "+bitexact", "-movflags", "+faststart", mp4,
], { stdio: "inherit" });
const bytes = statSync(mp4).size;
if (bytes >= 40 * 1024) throw new Error(`the MP4 is ${bytes} bytes, over 40 KB`);
const card = (shade) => (x, y) => (y >= 80 && y < 100 && x >= 40 && x < 280 ? hex("#f4efe6") : hex(shade));
write(join(title, "poster.png"), png(320, 180, card("#1f3a34")));
["#16302a", "#1a352f", "#1f3a34", "#244039", "#29463e", "#2e4c43"].forEach((s, n) => write(join(title, "review", `frame-0${n + 1}.png`), png(320, 180, card(s))));

console.log(`v3 fixtures written; the MP4 is ${bytes} bytes`);
