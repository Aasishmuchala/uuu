// The relay token (CONTRACTS C3): v1.<kind>.<subject>.<exp>.<mac>. `kind` is `a` (an agent;
// subject is its id, a lower-case UUID) or `t` (the owner's test; subject is an agent slug).
// `mac` is the hex HMAC-SHA256 of the text before it, keyed with the 64-character secret.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SECRET_RE = /^[0-9a-f]{64}$/;
export const AGENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOKEN_RE = /^v1\.([at])\.([0-9a-z-]{1,64})\.([1-9][0-9]{0,11})\.([0-9a-f]{64})$/;
// A token is accepted only when it ends within this long from now.
export const MAX_AHEAD_SEC = 7 * 3600;

function subjectFits(kind, subject) {
  return kind === "a" ? AGENT_ID_RE.test(subject) : kind === "t" ? SLUG_RE.test(subject) : false;
}

function macOf(secret, text) {
  return createHmac("sha256", Buffer.from(secret, "ascii")).update(text, "ascii").digest("hex");
}

// `now` is Date.now()-style milliseconds; a number below 1e11 is read as Unix seconds.
function nowSec(now) {
  const n = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  return Math.floor(n < 1e11 ? n : n / 1000);
}

export function mintToken(secret, kind, subject, exp) {
  if (typeof secret !== "string" || !SECRET_RE.test(secret)) throw new Error("relay token: the secret is not 64 hex characters");
  if (!subjectFits(kind, subject)) throw new Error("relay token: kind or subject is not valid");
  if (!Number.isSafeInteger(exp) || exp < 1 || String(exp).length > 12) throw new Error("relay token: exp must be Unix seconds");
  const text = `v1.${kind}.${subject}.${exp}`;
  return `${text}.${macOf(secret, text)}`;
}

// Returns { kind, subject, exp } when the token is accepted, else null. Never throws.
export function checkToken(secret, token, now) {
  if (typeof secret !== "string" || !SECRET_RE.test(secret)) return null;
  if (typeof token !== "string" || token.length > 200) return null;
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const [, kind, subject, expText, mac] = m;
  if (!subjectFits(kind, subject)) return null;
  const want = Buffer.from(macOf(secret, `v1.${kind}.${subject}.${expText}`), "ascii");
  const got = Buffer.from(mac, "ascii");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const exp = Number(expText);
  const t = nowSec(now);
  if (!(exp > t) || exp > t + MAX_AHEAD_SEC) return null;
  return { kind, subject, exp };
}
