// The pictures of the staging harness (PLAN-APPS-ASTRYX T6): real renders, and from each the
// files the fake door hands back, made once with ffmpeg so an "enhanced" still is visibly the
// same building as the render it came from. Nothing is downloaded and nothing is sent anywhere.
//
// makePictures({ from, into }) reads every JPG, PNG or WebP of `from` (read only, at most 12,
// in name order), and for each writes under `into/<n>/`:
//   render.jpg    the render as is, 2560 wide at most
//   enhanced.jpg  a restrained grade: a little contrast, a touch of warmth, slight sharpening
//   warm.jpg      the same, warmer (what a "golden hour" take hands back)
//   dusk.jpg      the same, cooler and darker (a "blue hour" or night take)
//   closeup.jpg   the middle of the enhanced still, filled to the frame (a close-up take)
//   master.jpg    the enhanced still at 3840 wide
//   clip.mp4      3 seconds, 1280x720, a slow push-in on the enhanced still (zoompan)
// With no `from`, the harness first fills `into/sample/` with reframings of the one real render
// in the repository (apps/render-to-film/public/sample-render.jpg): sampleRenders().
//
// Each set carries a small signature (16x9 grey levels, mean taken out) so the fakes can tell
// which render a picture the app sent them was made from: nearest(bytes).
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FFMPEG = "/opt/homebrew/bin/ffmpeg";
export const FFPROBE = "/opt/homebrew/bin/ffprobe";
const HERE = dirname(fileURLToPath(import.meta.url));
export const SAMPLE_RENDER = join(HERE, "..", "..", "..", "..", "apps", "render-to-film", "public", "sample-render.jpg");
const PICTURE = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SIG_W = 16;
const SIG_H = 9;

// The reframings of the sample render (2560x1440): x, y, width, height in its pixels, each
// 16:9, and whether it is mirrored. Twelve, so a project of twelve renders has no repeat.
export const SAMPLE_FRAMES = Object.freeze([
  { name: "Water wall, wide view.jpg", crop: [0, 0, 2560, 1440] },
  { name: "Cranes by the west pool.jpg", crop: [500, 780, 1280, 720] },
  { name: "Cranes by the east pool.jpg", crop: [1280, 760, 1280, 720] },
  { name: "Three water spouts.jpg", crop: [780, 560, 1280, 720] },
  { name: "Stone wall against the sky.jpg", crop: [320, 0, 1920, 1080] },
  { name: "Lamp and flowering trees.jpg", crop: [0, 300, 1600, 900] },
  { name: "Pool edge and planting.jpg", crop: [0, 640, 1422, 800] },
  { name: "Garden from the east path.jpg", crop: [160, 90, 2240, 1260], mirror: true },
  { name: "Wall and pools, low view.jpg", crop: [240, 270, 2080, 1170] },
  { name: "Spouts from the west.jpg", crop: [600, 420, 1600, 900], mirror: true },
  { name: "East lamp and terrace.jpg", crop: [1120, 300, 1440, 810] },
  { name: "Planting before the wall.jpg", crop: [480, 600, 1600, 900], mirror: true },
]);

function ff(args) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], { encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).slice(0, 400)}`);
}

function sizeOf(file) {
  const r = spawnSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  const [w, h] = String(r.stdout).trim().split(",").map(Number);
  if (!(w > 0 && h > 0)) throw new Error(`could not read the size of ${file}`);
  return { width: w, height: h };
}

// Eight to twelve 16:9 reframings of the sample render into `dir`. -> the folder
export function sampleRenders(dir, { count = SAMPLE_FRAMES.length } = {}) {
  if (!existsSync(SAMPLE_RENDER)) throw new Error(`the sample render is missing: ${SAMPLE_RENDER}`);
  mkdirSync(dir, { recursive: true });
  for (const f of SAMPLE_FRAMES.slice(0, count)) {
    let [x, y, w, h] = f.crop;
    h = Math.round((w * 9) / 16);
    if (y + h > 1440) y = 1440 - h;
    const out = join(dir, f.name);
    if (existsSync(out)) continue;
    const vf = [`crop=${w}:${h}:${x}:${y}`, f.mirror ? "hflip" : null, "scale=1920:1080:flags=lanczos"].filter(Boolean).join(",");
    ff(["-i", SAMPLE_RENDER, "-vf", vf, "-q:v", "3", out]);
  }
  return dir;
}

// The signature of a picture's bytes (any format ffmpeg reads). -> Promise<Float64Array | null>
export function signature(bytes) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-frames:v", "1",
      "-vf", `scale=${SIG_W}:${SIG_H}:flags=area,format=gray`, "-f", "rawvideo", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
    const out = [];
    child.stdout.on("data", (d) => out.push(d));
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      const raw = Buffer.concat(out);
      if (code !== 0 || raw.length < SIG_W * SIG_H) return resolve(null);
      const v = new Float64Array(SIG_W * SIG_H);
      let mean = 0;
      for (let i = 0; i < v.length; i += 1) { v[i] = raw[i]; mean += raw[i]; }
      mean /= v.length;
      for (let i = 0; i < v.length; i += 1) v[i] -= mean;
      resolve(v);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(bytes);
  });
}

const distance = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d += Math.abs(a[i] - b[i]);
  return d;
};

// -> { dir, sets: [...], nearest(bytes) -> Promise<set>, byName(name) }
export async function makePictures({ from, into, limit = 12 } = {}) {
  if (!existsSync(FFMPEG) || !existsSync(FFPROBE)) throw new Error("ffmpeg is not installed at /opt/homebrew/bin");
  if (typeof into !== "string" || !into.startsWith("/")) throw new Error("makePictures: into must be an absolute folder");
  mkdirSync(into, { recursive: true });
  const source = from ? from : sampleRenders(join(into, "sample"), { count: Math.min(limit, SAMPLE_FRAMES.length) });
  const names = readdirSync(source).filter((n) => !n.startsWith(".") && PICTURE.has(extname(n).toLowerCase())
    && statSync(join(source, n)).isFile()).sort().slice(0, limit);
  if (names.length === 0) throw new Error(`no JPG, PNG or WebP picture in ${source}`);
  const sets = [];
  for (const [i, name] of names.entries()) {
    const dir = join(into, String(i + 1));
    mkdirSync(dir, { recursive: true });
    // The owner's file is only ever read, by this one copy.
    const original = join(dir, `original${extname(name).toLowerCase()}`);
    if (!existsSync(original)) copyFileSync(join(source, name), original);
    const f = (n) => join(dir, n);
    if (!existsSync(f("render.jpg"))) ff(["-i", original, "-vf", "scale='min(2560,iw)':-2:flags=lanczos", "-q:v", "2", f("render.jpg")]);
    if (!existsSync(f("enhanced.jpg"))) {
      ff(["-i", f("render.jpg"), "-vf", "eq=contrast=1.07:saturation=1.06:gamma=0.98,colorbalance=rs=0.03:gs=0.01:bs=-0.03:rm=0.02:bm=-0.02,unsharp=5:5:0.6", "-q:v", "2", f("enhanced.jpg")]);
    }
    if (!existsSync(f("warm.jpg"))) {
      ff(["-i", f("render.jpg"), "-vf", "eq=contrast=1.08:saturation=1.1:gamma=0.97,colorbalance=rs=0.09:gs=0.03:bs=-0.08:rm=0.07:gm=0.02:bm=-0.06:rh=0.05:bh=-0.05,unsharp=5:5:0.6", "-q:v", "2", f("warm.jpg")]);
    }
    if (!existsSync(f("dusk.jpg"))) {
      ff(["-i", f("render.jpg"), "-vf", "eq=contrast=1.1:saturation=0.85:brightness=-0.08:gamma=0.9,colorbalance=rs=-0.06:bs=0.1:rm=-0.04:bm=0.07:rh=0.04,unsharp=5:5:0.5", "-q:v", "2", f("dusk.jpg")]);
    }
    if (!existsSync(f("closeup.jpg"))) ff(["-i", f("enhanced.jpg"), "-vf", "crop=iw/2.2:ih/2.2:(iw-iw/2.2)/2:(ih-ih/2.2)/1.6,scale=1920:-2:flags=lanczos", "-q:v", "2", f("closeup.jpg")]);
    if (!existsSync(f("master.jpg"))) ff(["-i", f("enhanced.jpg"), "-vf", "scale=3840:-2:flags=lanczos", "-q:v", "2", f("master.jpg")]);
    if (!existsSync(f("clip.mp4"))) {
      ff(["-loop", "1", "-i", f("enhanced.jpg"), "-vf",
        "scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,zoompan=z='min(1.0+0.0018*on,1.16)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=72:s=1280x720:fps=24,format=yuv420p",
        "-t", "3", "-r", "24", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", f("clip.mp4")]);
    }
    const sig = await signature(readFileSync(f("render.jpg")));
    sets.push({
      index: i, name, dir, sig, ...sizeOf(f("render.jpg")),
      render: f("render.jpg"), enhanced: f("enhanced.jpg"), warm: f("warm.jpg"), dusk: f("dusk.jpg"),
      closeup: f("closeup.jpg"), master: f("master.jpg"), clip: f("clip.mp4"),
    });
  }
  return {
    dir: into,
    sample: !from,
    sets,
    byName: (n) => sets.find((s) => s.name === n) || null,
    // The set a picture was made from: the one with the nearest signature (the first when unreadable).
    async nearest(bytes) {
      const sig = await signature(bytes);
      if (!sig) return sets[0];
      let best = sets[0];
      let bestD = Infinity;
      for (const s of sets) {
        if (!s.sig) continue;
        const d = distance(sig, s.sig);
        if (d < bestD) { bestD = d; best = s; }
      }
      return best;
    },
  };
}
