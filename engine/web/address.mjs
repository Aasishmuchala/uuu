// What address the web door may open (PLAN-V5 K11, rows 8 to 10). Pure functions, zero
// dependencies. `checkAddress` reads the text an agent (or a redirect) gave; `hostAllowed`
// applies the owner's lists; `isPublic` judges one resolved address by the table, and
// `isOwnAddress` by this Mac's own interfaces. Anything that cannot be parsed is not public.
import { networkInterfaces } from "node:os";

export const MAX_ADDRESS = 1024;
export const MAX_QUERY = 256;
// Row 8: a host name of letters, digits and hyphens with a letter-only last label. So no IP
// in any spelling, no bare name, no trailing dot, no underscore.
export const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_ENDINGS = [".localhost", ".local", ".internal", ".home.arpa"];
// Printable ASCII only: no control character, no space, nothing outside ASCII.
const PRINTABLE = /^[\x21-\x7e]*$/;

// Row 8. { ok: true, url (a URL), href (without the fragment), host, port, secure } or
// { ok: false, reason } with a fixed reason word. Never throws.
export function checkAddress(text) {
  if (typeof text !== "string" || text.length === 0) return { ok: false, reason: "empty" };
  if (text.length > MAX_ADDRESS) return { ok: false, reason: "too_long" };
  if (!PRINTABLE.test(text)) return { ok: false, reason: "character" };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "not_an_address" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "credentials" };
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return { ok: false, reason: "port" };
  if (url.search.length - 1 > MAX_QUERY) return { ok: false, reason: "query" };
  const host = url.hostname.toLowerCase();
  if (!HOST_RE.test(host)) return { ok: false, reason: "host" };
  if (LOCAL_ENDINGS.some((e) => host.endsWith(e))) return { ok: false, reason: "host" };
  url.hash = "";
  const secure = url.protocol === "https:";
  const port = url.port === "" ? (secure ? 443 : 80) : Number(url.port);
  if (url.href.length > MAX_ADDRESS) return { ok: false, reason: "too_long" };
  return { ok: true, url, href: url.href, host, port, secure };
}

// Row 9. False when the host or a parent of it is on the block list, or when the allow list
// is not empty and the host is under none of its entries. Block beats allow.
export function hostAllowed(host, allow, block) {
  if (typeof host !== "string" || host === "") return false;
  const h = host.toLowerCase();
  const under = (entry) => {
    if (typeof entry !== "string") return false;
    const e = entry.trim().toLowerCase().replace(/^\*?\./, "");
    return e !== "" && (h === e || h.endsWith(`.${e}`));
  };
  if (Array.isArray(block) && block.some(under)) return false;
  if (Array.isArray(allow) && allow.length > 0) return allow.some(under);
  return true;
}

// ---- addresses ---------------------------------------------------------------

// A dotted-quad IPv4 address as a 32-bit number, else null. Only the plain form a resolver
// gives (four decimal parts, no leading zeros); any other spelling is not an address here.
function parseIPv4(s) {
  if (typeof s !== "string") return null;
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

// An IPv6 address as eight 16-bit numbers, else null. A zone (`%en0`) is not accepted.
function parseIPv6(s) {
  if (typeof s !== "string" || s.length > 45 || s.includes("%")) return null;
  let text = s;
  let tail = [];
  const lastColon = text.lastIndexOf(":");
  if (lastColon !== -1 && text.indexOf(".", lastColon) !== -1) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    text = `${text.slice(0, lastColon + 1)}`;
    // "::1.2.3.4" leaves "::", "a::1.2.3.4" leaves "a::", "a:b:1.2.3.4" leaves "a:b:"
    if (text.endsWith(":") && !text.endsWith("::")) text = text.slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const group = (g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : null);
  const side = (t) => (t === "" ? [] : t.split(":").map(group));
  const head = side(halves[0]);
  const back = halves.length === 2 ? side(halves[1]) : [];
  if (head.includes(null) || back.includes(null)) return null;
  const given = head.length + back.length + tail.length;
  if (halves.length === 2) {
    if (given > 7) return null;
    return [...head, ...new Array(8 - given).fill(0), ...back, ...tail];
  }
  if (given !== 8) return null;
  return [...head, ...tail];
}

const v4 = (a, b, c, d) => ((a * 256 + b) * 256 + c) * 256 + d;
// Row 10's IPv4 table: [first address, prefix length].
const V4_PRIVATE = [
  [v4(0, 0, 0, 0), 8], [v4(10, 0, 0, 0), 8], [v4(100, 64, 0, 0), 10], [v4(127, 0, 0, 0), 8],
  [v4(169, 254, 0, 0), 16], [v4(172, 16, 0, 0), 12], [v4(192, 0, 0, 0), 24], [v4(192, 0, 2, 0), 24],
  [v4(192, 88, 99, 0), 24], [v4(192, 168, 0, 0), 16], [v4(198, 18, 0, 0), 15], [v4(198, 51, 100, 0), 24],
  [v4(203, 0, 113, 0), 24], [v4(224, 0, 0, 0), 4], [v4(240, 0, 0, 0), 4],
];

function v4Public(n) {
  return !V4_PRIVATE.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}

// True when the 8 groups start with the given groups under a prefix of `bits` bits.
function under(g, prefix, bits) {
  for (let i = 0; i < 8 && bits > 0; i += 1, bits -= 16) {
    const want = prefix[i] || 0;
    if (bits >= 16) {
      if (g[i] !== want) return false;
    } else {
      const shift = 16 - bits;
      if ((g[i] >> shift) !== (want >> shift)) return false;
    }
  }
  return true;
}

const inner = (hi, lo) => hi * 65536 + lo;

function v6Public(g) {
  // Forms that carry an IPv4 address are judged by it: the IPv4-compatible ::/96 (so `::`
  // and `::1` too), mapped ::ffff:0:0/96, NAT64 64:ff9b::/96 and 6to4 2002::/16.
  if (under(g, [0, 0, 0, 0, 0, 0], 96)) return v4Public(inner(g[6], g[7]));
  if (under(g, [0, 0, 0, 0, 0, 0xffff], 96)) return v4Public(inner(g[6], g[7]));
  if (under(g, [0x64, 0xff9b, 0, 0, 0, 0], 96)) return v4Public(inner(g[6], g[7]));
  if (under(g, [0x2002], 16)) return v4Public(inner(g[1], g[2]));
  // Only global unicast (2000::/3) is public; inside it, documentation and Teredo are not.
  // Everything else, fc00::/7, fe80::/10, ff00::/8, 64:ff9b:1::/48 among them, is refused.
  if (!under(g, [0x2000], 3)) return false;
  if (under(g, [0x2001, 0x0db8], 32)) return false;
  if (under(g, [0x2001, 0], 32)) return false;
  return true;
}

// Row 10, by the table only (pure). An address that does not parse is not public.
export function isPublic(ip) {
  const n = parseIPv4(ip);
  if (n !== null) return v4Public(n);
  const g = parseIPv6(ip);
  return g !== null && v6Public(g);
}

// One spelling per address, so two spellings of one address compare equal. IPv6 forms that
// carry an IPv4 address are keyed by it. Null for what does not parse.
export function addressKey(ip) {
  const n = parseIPv4(ip);
  if (n !== null) return `4:${n}`;
  const g = parseIPv6(ip);
  if (g === null) return null;
  if (under(g, [0, 0, 0, 0, 0, 0xffff], 96) || under(g, [0, 0, 0, 0, 0, 0], 96)) return `4:${inner(g[6], g[7])}`;
  return `6:${g.join(":")}`;
}

// True when the address is one of this Mac's own (every interface, read now). `interfaces`
// is os.networkInterfaces()'s shape, for tests.
export function isOwnAddress(ip, interfaces = networkInterfaces()) {
  const key = addressKey(ip);
  if (key === null) return true;
  for (const list of Object.values(interfaces || {})) {
    for (const a of list || []) {
      if (a && typeof a.address === "string" && addressKey(a.address.split("%")[0]) === key) return true;
    }
  }
  return false;
}
