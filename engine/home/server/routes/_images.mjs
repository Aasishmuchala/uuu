// Byte readers for images agents wrote (CONTRACTS-V2 17.8), shared by routes/view.mjs and
// routes/studio-art.mjs. The first three are pure functions on a Buffer: they never throw, never read
// past the end, and answer null for anything they do not recognise. readGoalBytes is the one function
// here that touches the disk: it reads a file of a goal's folder as bytes, with the rules of
// lib/taskfiles.mjs (no link on the way, then openChecked: O_NOFOLLOW and O_NONBLOCK, a regular file, and
// the file opened is the one at that place inside the goal's folder).
// A helper, not a feature: the default export registers nothing.
import { closeSync, lstatSync, readSync } from "node:fs";
import { join } from "node:path";
import { goalFolder, openChecked } from "../lib/taskfiles.mjs";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_GIF_FRAMES = 100000;

const isBuffer = (b) => Buffer.isBuffer(b) || b instanceof Uint8Array;
const startsWith = (b, bytes, at = 0) => b.length >= at + bytes.length && bytes.every((v, i) => b[at + i] === v);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

// "png" | "gif" | "jpeg" | "webp" | null, from the first bytes.
export function sniff(buffer) {
  if (!isBuffer(buffer)) return null;
  if (startsWith(buffer, PNG_SIGNATURE)) return "png";
  if (startsWith(buffer, ascii("GIF87a")) || startsWith(buffer, ascii("GIF89a"))) return "gif";
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buffer, ascii("RIFF")) && startsWith(buffer, ascii("WEBP"), 8)) return "webp";
  return null;
}

// { w, h } from a PNG's header (the IHDR chunk, bytes 16 to 23, big-endian), or null.
export function pngSize(buffer) {
  if (!isBuffer(buffer) || buffer.length < 24 || !startsWith(buffer, PNG_SIGNATURE)) return null;
  if (!startsWith(buffer, ascii("IHDR"), 12)) return null;
  const b = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (w < 1 || h < 1 || w > 0x7fffffff || h > 0x7fffffff) return null;
  return { w, h };
}

// The number of image blocks in a GIF, or null when the bytes are not a whole, well-formed GIF.
// Walks the blocks only: the header, the optional global colour table, then extensions (0x21, skipped
// with their sub-blocks), images (0x2C, counted; local colour table, code-size byte and sub-blocks
// skipped) up to the trailer (0x3B). Anything else, or running off the end, is null.
export function gifFrameCount(buffer) {
  if (!isBuffer(buffer) || sniff(buffer) !== "gif" || buffer.length < 13) return null;
  const len = buffer.length;
  const tableSize = (packed) => (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  // Skips sub-blocks starting at p; the position after the zero-length terminator, or -1.
  const skipSubBlocks = (p) => {
    while (p < len) {
      const n = buffer[p];
      p += 1;
      if (n === 0) return p;
      p += n;
    }
    return -1;
  };
  let pos = 13 + tableSize(buffer[10]);
  let count = 0;
  while (pos < len) {
    const b = buffer[pos];
    if (b === 0x3b) return count;
    if (b === 0x21) {
      if (pos + 2 > len) return null;
      pos = skipSubBlocks(pos + 2);
      if (pos < 0) return null;
    } else if (b === 0x2c) {
      if (pos + 10 > len) return null;
      count += 1;
      if (count > MAX_GIF_FRAMES) return null;
      pos += 10 + tableSize(buffer[pos + 9]);
      pos += 1;                                   // the LZW minimum code size
      if (pos > len) return null;
      pos = skipSubBlocks(pos);
      if (pos < 0) return null;
    } else {
      return null;
    }
  }
  return null;
}

function lstatOrNull(p) {
  try { return lstatSync(p); } catch { return null; }
}

// One file of a goal's folder as bytes. rel is the path inside the goal's folder.
// -> { bytes, size, mtimeMs, real, dev, ino } (bytes: at most maxBytes; size is the whole file's),
//    { tooLarge: true, size } when the file is over maxBytes and readOver is false, or null.
export function readGoalBytes(config, identifier, rel, { maxBytes, readOver = false } = {}) {
  const base = goalFolder(config, identifier);
  if (!base || typeof rel !== "string" || !rel || rel.length > 1024) return null;
  if (rel.includes("\\") || rel.includes("\0") || rel.startsWith("/")) return null;
  const parts = rel.split("/");
  if (parts.some((s) => !s || s === "." || s === "..")) return null;
  let dir = base;
  for (const part of parts.slice(0, -1)) {
    dir = join(dir, part);
    const st = lstatOrNull(dir);
    if (!st || !st.isDirectory()) return null;          // a link or a file on the way is refused
  }
  const opened = openChecked(join(dir, parts[parts.length - 1]), base);
  if (!opened) return null;
  const { fd, st, real } = opened;
  try {
    if (st.size > maxBytes && !readOver) return { tooLarge: true, size: st.size };
    const want = Math.min(st.size, maxBytes);
    const bytes = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const n = readSync(fd, bytes, got, want - got, got);
      if (n <= 0) break;
      got += n;
    }
    return { bytes: bytes.subarray(0, got), size: st.size, mtimeMs: st.mtimeMs, real, dev: st.dev, ino: st.ino };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// The same file is still there, a regular file and not a link: used just before a file is streamed.
export function sameFile(found) {
  const st = lstatOrNull(found.real);
  return !!st && st.isFile() && st.dev === found.dev && st.ino === found.ino && st.size === found.size;
}

export default function register() {}
