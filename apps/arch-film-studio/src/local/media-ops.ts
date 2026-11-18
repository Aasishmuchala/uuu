/**
 * Video work on this Mac with ffmpeg and ffprobe (`$FFMPEG`, `$FFPROBE`):
 * capture frames, trim, stitch with fades, export a timeline, and probe a
 * file. K24.8.
 *
 * Inputs are kept files, named by key (`media/<id>.mp4`, or the same with a
 * `/files/` in front). Outputs are new files under `objects/media/`. Each run
 * is its own process group, ended at the stop (10 minutes) so no grandchild
 * outlives it. Only `node:` imports and erasable TypeScript.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isKey } from '../storage.ts';
import type { Storage } from '../storage.ts';
import type { TaskOutput } from './tasks.ts';

export type MediaDeps = {
  store: Storage;
  /** Test seams: the programs and the stop, in milliseconds. */
  ffmpeg?: string;
  ffprobe?: string;
  stopMs?: number;
};
/** What a finished video operation made: one file, or several (captured frames). */
export type MediaResult = TaskOutput | TaskOutput[];
export type ProbeInfo = { duration: number; frameRate: number; width: number; height: number };

export const MEDIA_STOP_MS = 10 * 60_000;
export const MEDIA_OUTPUT_MAX = 300 * 1024 * 1024;
const PROBE_STOP_MS = 30_000;
const MAX_INPUTS = 60;
const MAX_TIMES = 24;
const MAX_SIDE = 8192;
const STDERR_KEEP = 4096;
const FLAGS = ['-nostdin', '-hide_banner', '-y', '-loglevel', 'error'];

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

const refuse = (why: string): never => {
  throw new MediaError(why);
};

function program(deps: MediaDeps, which: 'ffmpeg' | 'ffprobe'): string {
  const bin = deps[which] ?? process.env[which === 'ffmpeg' ? 'FFMPEG' : 'FFPROBE'];
  if (!bin || !bin.startsWith('/')) return refuse('Video work needs ffmpeg, and this Mac has not said where it is.');
  return bin;
}

type Ran = { code: number | null; stdout: string; stderr: string; stopped: boolean };

/** Run a program in its own process group; the whole group is killed at `stopMs`. */
function run(bin: string, args: string[], stopMs: number, stdoutMax = 1 << 20): Promise<Ran> {
  return new Promise<Ran>((resolve, reject) => {
    const child = spawn(bin, args, { detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let stopped = false;
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      stopped = true;
      killGroup();
    }, stopMs);
    child.stdout.on('data', (c: Buffer) => {
      if (stdout.length < stdoutMax) stdout += c.toString('utf8');
      else killGroup();
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString('utf8')).slice(-STDERR_KEEP);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new MediaError('ffmpeg could not be started on this Mac.'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // A grandchild may hold the pipes open past the leader; end the group either way.
      killGroup();
      resolve({ code, stdout, stderr, stopped });
    });
  });
}

/** A kept file named by key (or by `/files/<key>`): its key and its real path. */
async function inputOf(raw: unknown, deps: MediaDeps): Promise<{ key: string; file: string }> {
  if (typeof raw !== 'string') return refuse('That video is not a file this Mac keeps.');
  const key = raw.startsWith('/files/') ? raw.slice('/files/'.length) : raw;
  if (!isKey(key)) return refuse('That video is not a file this Mac keeps.');
  let file: string;
  try {
    file = await deps.store.objectPath(key);
    const st = await lstat(file);
    if (!st.isFile()) return refuse('That video is not a file this Mac keeps.');
  } catch (err) {
    if (err instanceof MediaError) throw err;
    return refuse('That video is no longer on this Mac.');
  }
  return { key, file };
}

async function inputsOf(raw: unknown, deps: MediaDeps, min: number): Promise<Array<{ key: string; file: string }>> {
  if (!Array.isArray(raw) || raw.length < min || raw.length > MAX_INPUTS) {
    return refuse(min === 1 ? 'Pick a video first.' : 'Pick the videos first.');
  }
  return Promise.all(raw.map((r) => inputOf(r, deps)));
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const t6 = (n: number) => String(Math.round(n * 1e6) / 1e6);

/** A fresh output key, its final path and a temp path beside it that is not a key. */
async function newOutput(deps: MediaDeps, ext: 'mp4' | 'png') {
  const key = `media/${randomUUID()}.${ext}`;
  const file = await deps.store.objectPath(key);
  const tmp = join(dirname(file), `~${randomUUID()}.${ext}`);
  return { key, file, tmp };
}

async function finishOutput(out: { key: string; file: string; tmp: string }, type: string): Promise<TaskOutput> {
  try {
    const st = await stat(out.tmp);
    if (st.size === 0) return refuse('The video work made nothing.');
    if (st.size >= MEDIA_OUTPUT_MAX) return refuse('The result is larger than this app keeps.');
    await chmod(out.tmp, 0o600);
    await rename(out.tmp, out.file);
  } catch (err) {
    await unlink(out.tmp).catch(() => {});
    if (err instanceof MediaError) throw err;
    return refuse('The video work made nothing.');
  }
  return { key: out.key, type, width: null, height: null, duration: null, fps: null };
}

/** ffmpeg to a temp file; the file is kept under its key only when ffmpeg succeeds. */
async function encode(
  deps: MediaDeps,
  ext: 'mp4' | 'png',
  args: (outPath: string) => string[]
): Promise<TaskOutput> {
  const bin = program(deps, 'ffmpeg');
  const out = await newOutput(deps, ext);
  let ran: Ran;
  try {
    ran = await run(bin, [...FLAGS, ...args(out.tmp)], deps.stopMs ?? MEDIA_STOP_MS);
  } catch (err) {
    await unlink(out.tmp).catch(() => {});
    throw err;
  }
  if (ran.stopped) {
    await unlink(out.tmp).catch(() => {});
    return refuse('The video work took too long and was stopped.');
  }
  if (ran.code !== 0) {
    await unlink(out.tmp).catch(() => {});
    return refuse('ffmpeg could not do this to that video.');
  }
  return finishOutput(out, ext === 'mp4' ? 'video/mp4' : 'image/png');
}

const IN = ['-protocol_whitelist', 'file,pipe'];
const H264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart'];
const LIMIT = ['-fs', String(MEDIA_OUTPUT_MAX)];

async function captureFrames(op: Record<string, any>, deps: MediaDeps): Promise<TaskOutput[]> {
  const [src] = await inputsOf(op['input'], deps, 1);
  const times = op['parameters']?.times;
  if (!Array.isArray(times) || times.length < 1 || times.length > MAX_TIMES || !times.every((t) => finite(t) && t >= 0 && t < 86400)) {
    return refuse('Those frame times are not usable.');
  }
  const made: TaskOutput[] = [];
  try {
    for (const t of times as number[]) {
      made.push(
        await encode(deps, 'png', (o) => [...IN, '-ss', t6(t), '-i', src!.file, '-frames:v', '1', ...LIMIT, o])
      );
    }
  } catch (err) {
    for (const m of made) await unlink(await deps.store.objectPath(m.key)).catch(() => {});
    throw err;
  }
  return made;
}

async function trim(op: Record<string, any>, deps: MediaDeps): Promise<TaskOutput> {
  const [src] = await inputsOf(op['input'], deps, 1);
  const { start, end } = op['parameters'] ?? {};
  if (!finite(start) || !finite(end) || start < 0 || end <= start || end > 86400) return refuse('That cut is not usable.');
  return encode(deps, 'mp4', (o) => [...IN, '-ss', t6(start), '-to', t6(end), '-i', src!.file, ...H264, ...LIMIT, o]);
}

const fit = (w: number, h: number) =>
  `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

async function stitch(op: Record<string, any>, deps: MediaDeps): Promise<TaskOutput> {
  const ins = await inputsOf(op['input'], deps, 1);
  const wanted = op['parameters']?.transition?.duration;
  const infos = await Promise.all(ins.map((i) => probe(i.key, deps)));
  const first = infos[0]!;
  const w = first.width - (first.width % 2);
  const h = first.height - (first.height % 2);
  const fps = first.frameRate > 0 && first.frameRate <= 60 ? Math.round(first.frameRate * 1000) / 1000 : 24;
  const shortest = Math.min(...infos.map((i) => i.duration));
  // A fade cannot be longer than half of the shortest piece it joins.
  const fade = ins.length > 1 && finite(wanted) && wanted > 0 ? Math.min(wanted, shortest / 2, 5) : 0;
  const args: string[] = [];
  for (const i of ins) args.push(...IN, '-i', i.file);
  const parts = ins.map((_, n) => `[${n}:v]${fit(w, h)},fps=${fps},format=yuv420p[v${n}]`);
  let last = 'v0';
  let acc = infos[0]!.duration;
  for (let n = 1; n < ins.length; n++) {
    const offset = acc - fade;
    const out = `x${n}`;
    parts.push(
      fade > 0
        ? `[${last}][v${n}]xfade=transition=fade:duration=${t6(fade)}:offset=${t6(Math.max(0, offset))}[${out}]`
        : `[${last}][v${n}]concat=n=2:v=1:a=0[${out}]`
    );
    last = out;
    acc = offset + infos[n]!.duration;
  }
  return encode(deps, 'mp4', (o) => [
    ...args,
    '-filter_complex',
    parts.join(';'),
    '-map',
    `[${last}]`,
    ...H264,
    ...LIMIT,
    o,
  ]);
}

async function timelineExport(op: Record<string, any>, deps: MediaDeps): Promise<TaskOutput> {
  const ins = await inputsOf(op['input'], deps, 1);
  const p = op['parameters'] ?? {};
  const clips = p.clips;
  const w = p.width;
  const h = p.height;
  const fps = p.fps;
  if (!Array.isArray(clips) || clips.length < 1 || clips.length > MAX_INPUTS) return refuse('There is nothing on the timeline to export.');
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || w > MAX_SIDE || h > MAX_SIDE || w % 2 || h % 2) {
    return refuse('That film size is not usable.');
  }
  if (!finite(fps) || fps < 1 || fps > 60) return refuse('That frame rate is not usable.');
  const index = new Map<string, number>();
  (op['input'] as string[]).forEach((raw, n) => {
    if (!index.has(raw)) index.set(raw, n);
  });
  const sorted = [...clips].sort((a: any, b: any) => (finite(a?.start) ? a.start : 0) - (finite(b?.start) ? b.start : 0));
  const args: string[] = [];
  for (const i of ins) args.push(...IN, '-i', i.file);
  const parts: string[] = [];
  sorted.forEach((c: any, n: number) => {
    const at = index.get(c?.assetId);
    if (at === undefined || !finite(c.sourceStart) || c.sourceStart < 0 || !finite(c.duration) || c.duration <= 0 || c.duration > 86400) {
      refuse('One of the clips on the timeline is not usable.');
    }
    parts.push(
      `[${at}:v]trim=start=${t6(c.sourceStart)}:duration=${t6(c.duration)},setpts=PTS-STARTPTS,${fit(w, h)},fps=${t6(fps)},format=yuv420p[c${n}]`
    );
  });
  const labels = sorted.map((_: unknown, n: number) => `[c${n}]`).join('');
  parts.push(`${labels}concat=n=${sorted.length}:v=1:a=0[outv]`);
  return encode(deps, 'mp4', (o) => [...args, '-filter_complex', parts.join(';'), '-map', '[outv]', ...H264, ...LIMIT, o]);
}

export async function runMediaOp(op: Record<string, unknown>, deps: MediaDeps): Promise<MediaResult> {
  switch (op['operation']) {
    case 'capture_frames':
      return captureFrames(op, deps);
    case 'trim':
      return trim(op, deps);
    case 'stitch':
      return stitch(op, deps);
    case 'timeline_export':
      return timelineExport(op, deps);
    default:
      return refuse('This app cannot do that to a video.');
  }
}

function rate(text: unknown): number {
  const m = /^(\d{1,9})(?:\/(\d{1,9}))?$/.exec(String(text ?? ''));
  if (!m) return 0;
  const d = m[2] === undefined ? 1 : Number(m[2]);
  return d > 0 ? Number(m[1]) / d : 0;
}

export async function probe(key: string, deps: MediaDeps): Promise<ProbeInfo> {
  const src = await inputOf(key, deps);
  const bin = program(deps, 'ffprobe');
  const ran = await run(
    bin,
    [
      '-v', 'error',
      '-protocol_whitelist', 'file,pipe',
      '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
      '-of', 'json',
      src.file,
    ],
    deps.stopMs ? Math.min(deps.stopMs, PROBE_STOP_MS) : PROBE_STOP_MS
  );
  if (ran.stopped || ran.code !== 0) return refuse('That video could not be read.');
  let json: any;
  try {
    json = JSON.parse(ran.stdout);
  } catch {
    return refuse('That video could not be read.');
  }
  const v = (Array.isArray(json?.streams) ? json.streams : []).find((s: any) => s?.width > 0 && s?.height > 0);
  const duration = Number(json?.format?.duration);
  if (!v || !Number.isFinite(duration) || duration < 0) return refuse('That is not a video this app can read.');
  return {
    duration: Math.round(duration * 1000) / 1000,
    frameRate: Math.round(rate(v.r_frame_rate) * 1000) / 1000,
    width: Number(v.width),
    height: Number(v.height),
  };
}
