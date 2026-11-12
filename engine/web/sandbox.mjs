// The two sandbox settings of the web door's watch (PLAN-V5 K11, with the corrections after
// T3): one for the downloader (`yt-dlp`), one for the media tools (`ffprobe`, `ffmpeg`,
// `whisper-cli`). Both are built for ONE job folder and written 0600 beside it, never inside
// it (the tools may write the job folder). Zero dependencies.
//
// What the sandbox tool (`srt`) is told, and why:
// - denyRead: every home folder, other disks and the shared temp folders (the owner's own
//   TMPDIR lives under /private/var/folders); allowRead re-opens only the job folder (and,
//   for the media tools, the one speech model file). The system stays readable.
// - allowWrite: the job folder only. denyWrite: /tmp/claude, which srt otherwise always
//   leaves writable when that folder exists.
// - network, downloader: each watch host and its sub-domains (srt's "*.x" does not match
//   "x", so both), nothing else (strictAllowlist), the owner's blocked hosts denied, and an
//   allowed name that resolves into a private range refused (K11 row 10; srt adds loopback,
//   link-local and this Mac's own addresses itself). Media tools: no network at all.
// srt ignores a key it does not know, silently: the tests prove each key here is read.
import { closeSync, constants, fstatSync, openSync, realpathSync, unlinkSync, writeSync } from "node:fs";
import { HOST_RE } from "./address.mjs";

// K11 row 10, as srt takes it (unbracketed literals and CIDRs). The IPv4 rules also bind the
// IPv6 forms that carry an IPv4 address (srt judges those by the address inside).
export const PRIVATE_RANGES = Object.freeze([
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15",
  "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
  "::/128", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8", "2001:db8::/32", "2001::/32",
  "64:ff9b::/96", "2002::/16",
]);
export const DENY_READ = Object.freeze(["/Users", "/Volumes", "/private/tmp", "/private/var/folders"]);
export const DENY_WRITE = Object.freeze(["/tmp/claude", "/private/tmp/claude"]);

// Host names by row 8's pattern, lower-cased, each with its sub-domains; anything else is
// dropped (a list entry can never widen the list into a pattern srt reads differently).
function domains(hosts) {
  const out = [];
  for (const h of Array.isArray(hosts) ? hosts : []) {
    if (typeof h !== "string") continue;
    const name = h.trim().toLowerCase().replace(/^\*?\./, "");
    if (!HOST_RE.test(name) || out.includes(name)) continue;
    out.push(name, `*.${name}`);
  }
  return out;
}

function filesystem(job, extraRead) {
  return {
    denyRead: [...DENY_READ],
    allowRead: [job, ...extraRead],
    allowWrite: [job],
    denyWrite: [...DENY_WRITE],
  };
}

// The downloader's settings. `job` must be a real path (no link anywhere in it). `extra` is
// for tests only (a stand-in's `127.0.0.1:<port>`); the door never passes it.
export function downloadSettings({ job, hosts, block, extra = [] }) {
  const blocked = domains(block);
  const allowed = domains(hosts).filter((d) => !blocked.includes(d));
  return {
    filesystem: filesystem(job, []),
    network: {
      allowedDomains: [...allowed, ...extra],
      deniedDomains: blocked,
      strictAllowlist: true,
      deniedResolvedAddresses: [...PRIVATE_RANGES],
    },
  };
}

// The media tools' settings: the job folder and the one model file, no network.
export function mediaSettings({ job, model }) {
  return {
    filesystem: filesystem(job, model ? [model] : []),
    network: {
      allowedDomains: [],
      deniedDomains: [],
      strictAllowlist: true,
      deniedResolvedAddresses: [...PRIVATE_RANGES],
    },
  };
}

// Writes one settings object as a new file, 0600, never through a link or over a file.
export function writeSettings(path, settings) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeSync(fd, `${JSON.stringify(settings, null, 1)}\n`);
    if ((fstatSync(fd).mode & 0o077) !== 0) throw new Error("settings file is not private");
  } catch (err) {
    closeSync(fd);
    try { unlinkSync(path); } catch { /* nothing was left */ }
    throw err;
  }
  closeSync(fd);
  return path;
}

// Both settings for the job folder `job` (created by the caller, 0700), written beside it as
// `<job>.download.json` and `<job>.media.json`. Returns the two paths and the objects.
export function writeJobSettings({ job, hosts, block, model, extra }) {
  const real = realpathSync(job);
  const modelReal = model ? realpathSync(model) : null;
  const download = downloadSettings({ job: real, hosts, block, extra });
  const media = mediaSettings({ job: real, model: modelReal });
  return {
    download: writeSettings(`${real}.download.json`, download),
    media: writeSettings(`${real}.media.json`, media),
    settings: { download, media },
  };
}
