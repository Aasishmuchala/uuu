// Captions (WebVTT, as `yt-dlp` writes them) to plain text for the web door's watch (PLAN-V5
// K11). The file comes from a video site and is hostile: one linear pass over its lines, no
// regular expression that can backtrack, tags and timings dropped, entities decoded, the
// characters that hide or reorder text removed as the door's reader removes them, rolling
// repeats folded, the result capped. Zero dependencies.
import { clean, decodeEntities } from "./readable.mjs";

export const MAX_TRANSCRIPT = 200_000;
export const MAX_CAPTIONS_BYTES = 5 * 1024 * 1024;
const MAX_LINE = 2000;
// How many earlier lines a repeat is looked for in (auto-captions roll each line through two
// or three cues).
const FOLD_BACK = 3;

// Removes every `<...>` (tags, voice spans, inline timestamps) from one line, in one pass; an
// unclosed `<` drops the rest of the line.
function untag(line) {
  let out = "";
  let inTag = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inTag) {
      if (c === ">") inTag = false;
    } else if (c === "<") {
      inTag = true;
    } else {
      out += c;
    }
  }
  return out;
}

const isTiming = (line) => line.includes("-->");
const blockKind = (first) => {
  const word = first.split(/[ \t]/, 1)[0];
  return word === "WEBVTT" || word === "NOTE" || word === "STYLE" || word === "REGION" ? word : "cue";
};

// { text, truncated }: the spoken lines in order, one per line, repeats folded.
export function vttToText(input, { max = MAX_TRANSCRIPT } = {}) {
  const src = String(input === undefined || input === null ? "" : input).slice(0, MAX_CAPTIONS_BYTES);
  const lines = src.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const out = [];
  let size = 0;
  let truncated = false;
  let block = [];
  const flush = () => {
    if (block.length === 0) return;
    const kind = blockKind(block[0]);
    const cue = block;
    block = [];
    if (kind !== "cue") return;
    const at = cue.findIndex(isTiming);
    if (at === -1) return; // no timing line: not a cue
    for (const raw of cue.slice(at + 1)) {
      if (truncated) return;
      const text = clean(decodeEntities(untag(raw.slice(0, MAX_LINE)))).replace(/\s+/g, " ").trim();
      if (text === "" || out.slice(-FOLD_BACK).includes(text)) continue;
      if (size + text.length + 1 > max) {
        truncated = true;
        return;
      }
      out.push(text);
      size += text.length + 1;
    }
  };
  for (const line of lines) {
    if (line.trim() === "") flush();
    else block.push(line);
  }
  flush();
  return { text: out.join("\n"), truncated };
}
