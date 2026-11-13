// The owner's Higgsfield sign-in, run by the generation door (PLAN-V5 K21): OAuth 2.1 with PKCE
// S256 and dynamic client registration, against the MCP host's own authorization server (why
// that one, not Clerk: higgsfield.mjs's opening note). The door is the only reader and writer of
// the token file `<state>/secrets/doors/higgsfield-oauth.json` (0600 in 0700; temp file, fsync,
// rename; read with the trust rule on every use, nothing cached but the one sign-in under way).
// `begin` registers a client when none is saved and answers the address the owner's browser
// opens; `finish` takes the code back once, with the state of the one pending begin, under 10
// minutes old; `token` refreshes when under 60 seconds remain, or once after a 401, one refresh
// at a time, keeping a rotated refresh token; a refused refresh marks the file `refused` until
// the owner signs in again. No token ever appears in a log line, an answer or an error, and
// tokens go only to Higgsfield's one origin. Zero dependencies.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { HF_LIMITS, HF_PATHS, checkHfOrigin, hfRequest, tokenGuard } from "./higgsfield.mjs";
import { readTrustedBytes, trustedFolder } from "./state.mjs";

export const HF_CLIENT_NAME = "uuu engine on this Mac";
export const HF_SCOPE = "openid email offline_access";
export const PENDING_MS = 10 * 60_000;
export const REFRESH_EARLY_MS = 60_000;
export const AUTH_FILE_BYTES = 16 * 1024;
const CLIENT_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const CODE_RE = /^[A-Za-z0-9._~-]{1,512}$/;
const STATE_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^[\x21-\x7e]{16,4096}$/;
const REDIRECT_RE = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/[A-Za-z0-9/_.-]{1,200}$/;
const MAX_LIFE_SEC = 30 * 24 * 3600;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isoMs = (v) => (typeof v === "string" && v.length <= 40 ? Date.parse(v) : NaN);

// `origin`: Higgsfield's or a stand-in (checkHfOrigin). `file`: the token file. `redirectUri`:
// the home server's return address, http://127.0.0.1:<home port>/... . `net`: the door's network
// (tests pass a stand-in's). `now`: the clock (ms). `log(line)`: one line per sign-in event,
// never a token, a code or a state.
export function createHfAuth({ origin, file, redirectUri, net, now, limits, log } = {}) {
  const up = checkHfOrigin(origin);
  if (typeof file !== "string" || file === "") throw new Error("createHfAuth: file is needed");
  const m = typeof redirectUri === "string" ? REDIRECT_RE.exec(redirectUri) : null;
  if (!m || Number(m[1]) > 65535 || redirectUri.includes("..")) throw new Error("createHfAuth: redirectUri must be http://127.0.0.1:<port>/<path>");
  const lim = { authBytes: HF_LIMITS.authBytes, authMs: HF_LIMITS.authMs, ...(limits || {}) };
  const clock = typeof now === "function" ? now : () => Date.now();
  const say = (line) => {
    try { if (typeof log === "function") log(`${new Date(clock()).toISOString()} ${line}`); } catch { /* a log failure changes nothing */ }
  };
  let pending = null;        // { state, verifier, clientId, at }: the one sign-in under way
  let beginSeq = 0;
  let registered = null;     // { clientId, redirectUri } registered by this door, not yet saved
  let refreshing = null;     // the one refresh under way, shared
  let epoch = 0;             // a sign-in or a sign-out since a refresh began voids its answer
  const recent = [];         // tokens seen lately, so a text holding an old one is still scrubbed

  // ---- the file ----
  // { ok: true, rec } or { ok: false, why: "signed_out" } (none, untrusted, or not the shape).
  function readFile() {
    if (!trustedFolder(dirname(file))) return { ok: false, why: "signed_out" };
    const b = readTrustedBytes(file, AUTH_FILE_BYTES);
    if (b === null || b === "missing") return { ok: false, why: "signed_out" };
    let v;
    try { v = JSON.parse(b.toString("utf8")); } catch { return { ok: false, why: "signed_out" }; }
    if (!isObj(v) || v.version !== 1 || typeof v.clientId !== "string" || !CLIENT_ID_RE.test(v.clientId)) return { ok: false, why: "signed_out" };
    if (typeof v.redirectUri !== "string" || typeof v.accessToken !== "string" || !TOKEN_RE.test(v.accessToken)) return { ok: false, why: "signed_out" };
    if (!Number.isFinite(isoMs(v.accessExpiresAt)) || typeof v.refused !== "boolean") return { ok: false, why: "signed_out" };
    if (!(v.refreshToken === null || (typeof v.refreshToken === "string" && TOKEN_RE.test(v.refreshToken)))) return { ok: false, why: "signed_out" };
    return { ok: true, rec: v };
  }

  function save(rec) {
    const dir = dirname(file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = lstatSync(dir);
    if (!st.isDirectory() || st.uid !== process.getuid()) throw new Error("the token folder is not the door's own");
    chmodSync(dir, 0o700);
    if (!trustedFolder(dir)) throw new Error("the token folder is not the door's own");
    const tmp = join(dir, `.${basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    let fd = null;
    try {
      fd = openSync(tmp, "wx", 0o600);
      writeSync(fd, `${JSON.stringify(rec)}\n`);
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tmp, file);
    } catch (err) {
      if (fd !== null) try { closeSync(fd); } catch { /* closed */ }
      try { unlinkSync(tmp); } catch { /* nothing was left */ }
      throw err;
    }
    for (const t of [rec.accessToken, rec.refreshToken]) if (typeof t === "string" && !recent.includes(t)) recent.push(t);
    while (recent.length > 6) recent.shift();
  }

  const guardOf = (rec) => tokenGuard([rec.accessToken, rec.refreshToken, ...recent]);

  // ---- the one exchange with the sign-in host ----
  async function post(path, body, type) {
    const r = await hfRequest(up, {
      net, method: "POST", path, body: Buffer.from(body, "utf8"), maxBytes: lim.authBytes, ms: lim.authMs,
      headers: { "Content-Type": type, Accept: "application/json" },
    });
    if (!r.ok) return { ok: false, why: "unreachable" };
    if (r.status >= 300 && r.status < 400) return { ok: false, why: "redirect", status: r.status };
    let json = null;
    try {
      const v = JSON.parse(r.body.toString("utf8"));
      json = isObj(v) ? v : null;
    } catch { json = null; }
    return { ok: true, status: r.status, json };
  }
  const form = (fields) => new URLSearchParams(fields).toString();

  // A token answer: { ok: true, access, refresh (or null), expiresIn } or { ok: false, why }.
  function readTokens(r) {
    if (!r.ok) return r;
    if (r.status !== 200) return { ok: false, why: r.status >= 400 && r.status < 500 && r.status !== 429 ? "refused" : "unreachable" };
    const j = r.json;
    if (!j || typeof j.access_token !== "string" || !TOKEN_RE.test(j.access_token)) return { ok: false, why: "bad_answer" };
    if (j.token_type !== undefined && !(typeof j.token_type === "string" && /^bearer$/i.test(j.token_type))) return { ok: false, why: "bad_answer" };
    if (j.refresh_token !== undefined && j.refresh_token !== null && !(typeof j.refresh_token === "string" && TOKEN_RE.test(j.refresh_token))) return { ok: false, why: "bad_answer" };
    const life = typeof j.expires_in === "number" && Number.isFinite(j.expires_in) && j.expires_in > 0 ? Math.min(j.expires_in, MAX_LIFE_SEC) : 3600;
    return { ok: true, access: j.access_token, refresh: typeof j.refresh_token === "string" ? j.refresh_token : null, expiresIn: life };
  }

  async function register() {
    const r = await post(HF_PATHS.register, JSON.stringify({
      client_name: HF_CLIENT_NAME, redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], token_endpoint_auth_method: "none", scope: HF_SCOPE,
    }), "application/json");
    if (!r.ok) return r;
    if (r.status !== 200 && r.status !== 201) return { ok: false, why: "not_registered" };
    const id = r.json && r.json.client_id;
    if (typeof id !== "string" || !CLIENT_ID_RE.test(id)) return { ok: false, why: "not_registered" };
    return { ok: true, clientId: id };
  }

  // ---- the refresh ----
  function refresh(rec) {
    if (refreshing) return refreshing;
    const at = epoch;
    refreshing = (async () => {
      const r = readTokens(await post(HF_PATHS.token, form({
        grant_type: "refresh_token", refresh_token: rec.refreshToken, client_id: rec.clientId, resource: up.resource,
      }), "application/x-www-form-urlencoded"));
      if (at !== epoch) return { ok: false, why: "again" };   // signed in or out meanwhile: read the file anew
      if (r.ok) {
        const next = {
          ...rec, accessToken: r.access, accessExpiresAt: new Date(clock() + r.expiresIn * 1000).toISOString(),
          refreshToken: r.refresh !== null ? r.refresh : rec.refreshToken, refused: false, savedAt: new Date(clock()).toISOString(),
        };
        try { save(next); } catch { return { ok: false, why: "not_saved" }; }
        say("higgsfield token refreshed");
        return { ok: true, access: next.accessToken, guard: guardOf(next) };
      }
      if (r.why === "refused") {
        try { save({ ...rec, refused: true, savedAt: new Date(clock()).toISOString() }); } catch { /* the next refresh is refused again */ }
        say("higgsfield refused the refresh; the owner must sign in again");
        return { ok: false, why: "refused" };
      }
      say(`higgsfield refresh did not finish (${r.why})`);
      return { ok: false, why: "unreachable" };
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  return {
    // { ok: true, url } (the address the owner's browser opens) or { ok: false, why }.
    async begin() {
      const seq = ++beginSeq;
      pending = null;
      let clientId = null;
      const f = readFile();
      if (f.ok && f.rec.redirectUri === redirectUri) clientId = f.rec.clientId;
      else if (registered && registered.redirectUri === redirectUri) clientId = registered.clientId;
      if (clientId === null) {
        const r = await register();
        if (!r.ok) {
          say(`higgsfield client not registered (${r.why})`);
          return { ok: false, why: r.why };
        }
        clientId = r.clientId;
        registered = { clientId, redirectUri };
      }
      if (seq !== beginSeq) return { ok: false, why: "replaced" };
      const state = randomBytes(32).toString("hex");
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      pending = { state, verifier, clientId, at: clock() };
      const q = new URLSearchParams({
        response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge,
        code_challenge_method: "S256", state, scope: HF_SCOPE, resource: up.resource,
      });
      say("higgsfield sign-in begun");
      return { ok: true, url: `${up.origin}${HF_PATHS.authorize}?${q}` };
    },

    // Takes the code back: { ok: true } (signed in, the file written) or { ok: false, why }.
    // The pending sign-in is cleared whatever happens, before anything else.
    async finish({ code, state } = {}) {
      const p = pending;
      pending = null;
      const no = (why) => {
        say(`higgsfield sign-in refused (${why})`);
        return { ok: false, why };
      };
      if (p === null) return no("no_pending");
      if (typeof state !== "string" || !STATE_RE.test(state) || !timingSafeEqual(Buffer.from(state, "utf8"), Buffer.from(p.state, "utf8"))) return no("bad_state");
      const t = clock();
      if (!(t >= p.at && t - p.at < PENDING_MS)) return no("expired");
      if (typeof code !== "string" || !CODE_RE.test(code)) return no("bad_code");
      const r = readTokens(await post(HF_PATHS.token, form({
        grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: p.clientId, code_verifier: p.verifier, resource: up.resource,
      }), "application/x-www-form-urlencoded"));
      if (!r.ok) return no(r.why === "refused" ? "code_refused" : r.why);
      epoch += 1;
      try {
        save({
          version: 1, clientId: p.clientId, redirectUri, accessToken: r.access, accessExpiresAt: new Date(clock() + r.expiresIn * 1000).toISOString(),
          refreshToken: r.refresh, refused: false, savedAt: new Date(clock()).toISOString(),
        });
      } catch {
        return no("not_saved");
      }
      if (registered && registered.clientId === p.clientId) registered = null;
      say("higgsfield signed in");
      return { ok: true };
    },

    // Signs out: the file removed, the sign-in under way dropped. { ok: true }.
    forget() {
      pending = null;
      epoch += 1;
      try { unlinkSync(file); } catch { /* there was none */ }
      say("higgsfield signed out");
      return { ok: true };
    },

    // A token to call the MCP with: { ok: true, access, guard } or { ok: false, why } with why
    // one of signed_out, refused, unreachable. `stale`: the token that just met a 401; when the
    // file still holds it, it is refreshed once (two callers share one refresh).
    async token({ stale } = {}) {
      for (let tries = 0; tries < 3; tries += 1) {
        const f = readFile();
        if (!f.ok) return { ok: false, why: "signed_out" };
        const rec = f.rec;
        if (rec.refused) return { ok: false, why: "refused" };
        const left = isoMs(rec.accessExpiresAt) - clock();
        const forced = typeof stale === "string" && stale === rec.accessToken;
        if (!forced && left >= REFRESH_EARLY_MS) return { ok: true, access: rec.accessToken, guard: guardOf(rec) };
        if (rec.refreshToken === null) return !forced && left > 0 ? { ok: true, access: rec.accessToken, guard: guardOf(rec) } : { ok: false, why: "signed_out" };
        const r = await refresh(rec);
        if (r.ok || r.why === "refused") return r;
        if (r.why === "again") continue;
        // Not refreshed now (no answer): a token with time left still works for this call.
        return !forced && left > 5_000 ? { ok: true, access: rec.accessToken, guard: guardOf(rec) } : { ok: false, why: "unreachable" };
      }
      return { ok: false, why: "unreachable" };
    },

    // { signedIn, refused } from the file, read now.
    status() {
      const f = readFile();
      if (!f.ok) return { signedIn: false, refused: false };
      if (f.rec.refused) return { signedIn: false, refused: true };
      return { signedIn: f.rec.refreshToken !== null || isoMs(f.rec.accessExpiresAt) > clock(), refused: false };
    },
  };
}
