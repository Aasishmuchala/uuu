// The owner's sign-ins run by the generation door: Higgsfield's (PLAN-V5 K21) and the owner's
// Runway account (PLAN-ONBOARD R1). OAuth 2.1 with PKCE S256 and dynamic client registration,
// against each MCP host's own authorization server (why that one, not Clerk: higgsfield.mjs's
// opening note; Runway's MCP host is its own authority, `.router/RUNWAY-MCP-FACTS.md`). One
// factory, `createAuth`, given the checked origin, the paths, the client name, the scope and the
// token file; `createHfAuth` and `createRwAuth` are it with each service's constants. The door is
// the only reader and writer of each token file (`<state>/secrets/doors/higgsfield-oauth.json`,
// `<state>/secrets/doors/runway-oauth.json`; 0600 in 0700; temp file, fsync, rename; read with
// the trust rule on every use, nothing cached but the one sign-in under way).
// `begin` registers a client when none is saved and answers the address the owner's browser
// opens; `finish` takes the code back once, with the state of the one pending begin, under 10
// minutes old, and exchanges it at once (Runway's code lives only minutes); `token` refreshes
// when under 60 seconds remain, or once after a 401, one refresh at a time, keeping a rotated
// refresh token; a refused refresh marks the file `refused` until the owner signs in again. No
// token ever appears in a log line, an answer or an error, and tokens go only to the one origin
// of their service. Neither service publishes a way to revoke a token: signing out deletes the
// file (the grant stays on the service's side until it ends or the owner removes the app there).
// Zero dependencies.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { HF_LIMITS, HF_PATHS, checkHfOrigin, hfRequest, tokenGuard } from "./higgsfield.mjs";
import { RW_LIMITS, RW_PATHS, RW_SCOPE, checkRwOrigin } from "./runway-mcp.mjs";
import { readTrustedBytes, trustedFolder } from "./state.mjs";

export const HF_CLIENT_NAME = "uuu engine on this Mac";
export const HF_SCOPE = "openid email offline_access";
// Runway's: the client R0 registered had this name; its id is long (487 characters seen).
export const RW_CLIENT_NAME = "uuu engine on this Mac";
export const PENDING_MS = 10 * 60_000;
export const REFRESH_EARLY_MS = 60_000;
export const AUTH_FILE_BYTES = 16 * 1024;
// Runway's record may be larger: a client id up to 2,048 characters and two tokens up to 8,192.
export const RW_AUTH_FILE_BYTES = 32 * 1024;
const CLIENT_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const CODE_RE = /^[A-Za-z0-9._~-]{1,512}$/;
const STATE_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^[\x21-\x7e]{16,4096}$/;
const REDIRECT_RE = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/[A-Za-z0-9/_.-]{1,200}$/;
const MAX_LIFE_SEC = 30 * 24 * 3600;
// What differs for Runway's sign-in: a longer client id, code and token are taken.
const RW_CLIENT_ID_RE = /^[A-Za-z0-9._:~-]{1,2048}$/;
const RW_CODE_RE = /^[A-Za-z0-9._~-]{1,2048}$/;
const RW_TOKEN_RE = /^[\x21-\x7e]{16,8192}$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isoMs = (v) => (typeof v === "string" && v.length <= 40 ? Date.parse(v) : NaN);

// The Higgsfield sign-in. `origin`: Higgsfield's or a stand-in (checkHfOrigin). `file`: the
// token file. `redirectUri`: the home server's return address, http://127.0.0.1:<home port>/... .
// `net`: the door's network (tests pass a stand-in's). `now`: the clock (ms). `log(line)`: one
// line per sign-in event, never a token, a code or a state.
export function createHfAuth(opts = {}) {
  return createAuth({
    ...opts, name: "createHfAuth", label: "higgsfield", up: checkHfOrigin(opts.origin), paths: HF_PATHS, clientName: HF_CLIENT_NAME, scope: HF_SCOPE,
    defaults: HF_LIMITS, clientIdRe: CLIENT_ID_RE, codeRe: CODE_RE, tokenRe: TOKEN_RE, fileBytes: AUTH_FILE_BYTES,
  });
}

// The owner's Runway account sign-in, the same rules: `origin` is Runway's MCP origin or a
// stand-in (checkRwOrigin); `file` is `<state>/secrets/doors/runway-oauth.json`.
export function createRwAuth(opts = {}) {
  return createAuth({
    ...opts, name: "createRwAuth", label: "runway", up: checkRwOrigin(opts.origin), paths: RW_PATHS, clientName: RW_CLIENT_NAME, scope: RW_SCOPE,
    defaults: RW_LIMITS, clientIdRe: RW_CLIENT_ID_RE, codeRe: RW_CODE_RE, tokenRe: RW_TOKEN_RE, fileBytes: RW_AUTH_FILE_BYTES,
  });
}

// One sign-in. `up`: the checked origin. `paths`: { register, authorize, token }. `label`: the
// service's word in log lines.
function createAuth({ name, label, up, paths, clientName, scope, defaults, clientIdRe, codeRe, tokenRe, fileBytes, file, redirectUri, net, now, limits, log } = {}) {
  if (typeof file !== "string" || file === "") throw new Error(`${name}: file is needed`);
  const m = typeof redirectUri === "string" ? REDIRECT_RE.exec(redirectUri) : null;
  if (!m || Number(m[1]) > 65535 || redirectUri.includes("..")) throw new Error(`${name}: redirectUri must be http://127.0.0.1:<port>/<path>`);
  const lim = { authBytes: defaults.authBytes, authMs: defaults.authMs, ...(limits || {}) };
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
    const b = readTrustedBytes(file, fileBytes);
    if (b === null || b === "missing") return { ok: false, why: "signed_out" };
    let v;
    try { v = JSON.parse(b.toString("utf8")); } catch { return { ok: false, why: "signed_out" }; }
    if (!isObj(v) || v.version !== 1 || typeof v.clientId !== "string" || !clientIdRe.test(v.clientId)) return { ok: false, why: "signed_out" };
    if (typeof v.redirectUri !== "string" || typeof v.accessToken !== "string" || !tokenRe.test(v.accessToken)) return { ok: false, why: "signed_out" };
    if (!Number.isFinite(isoMs(v.accessExpiresAt)) || typeof v.refused !== "boolean") return { ok: false, why: "signed_out" };
    if (!(v.refreshToken === null || (typeof v.refreshToken === "string" && tokenRe.test(v.refreshToken)))) return { ok: false, why: "signed_out" };
    return { ok: true, rec: v };
  }

  // A record the reader would refuse for its size is never written: the save fails instead (a
  // saved file that reads as signed out would look like a sign-in that worked).
  function save(rec) {
    const text = `${JSON.stringify(rec)}\n`;
    if (Buffer.byteLength(text, "utf8") > fileBytes) throw new Error("the sign-in record is larger than its file may be");
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
      writeSync(fd, text);
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
    if (!j || typeof j.access_token !== "string" || !tokenRe.test(j.access_token)) return { ok: false, why: "bad_answer" };
    if (j.token_type !== undefined && !(typeof j.token_type === "string" && /^bearer$/i.test(j.token_type))) return { ok: false, why: "bad_answer" };
    if (j.refresh_token !== undefined && j.refresh_token !== null && !(typeof j.refresh_token === "string" && tokenRe.test(j.refresh_token))) return { ok: false, why: "bad_answer" };
    const life = typeof j.expires_in === "number" && Number.isFinite(j.expires_in) && j.expires_in > 0 ? Math.min(j.expires_in, MAX_LIFE_SEC) : 3600;
    return { ok: true, access: j.access_token, refresh: typeof j.refresh_token === "string" ? j.refresh_token : null, expiresIn: life };
  }

  async function register() {
    const r = await post(paths.register, JSON.stringify({
      client_name: clientName, redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], token_endpoint_auth_method: "none", scope,
    }), "application/json");
    if (!r.ok) return r;
    if (r.status !== 200 && r.status !== 201) return { ok: false, why: "not_registered" };
    const id = r.json && r.json.client_id;
    if (typeof id !== "string" || !clientIdRe.test(id)) return { ok: false, why: "not_registered" };
    return { ok: true, clientId: id };
  }

  // ---- the refresh ----
  function refresh(rec) {
    if (refreshing) return refreshing;
    const at = epoch;
    refreshing = (async () => {
      const r = readTokens(await post(paths.token, form({
        grant_type: "refresh_token", refresh_token: rec.refreshToken, client_id: rec.clientId, resource: up.resource,
      }), "application/x-www-form-urlencoded"));
      if (at !== epoch) return { ok: false, why: "again" };   // signed in or out meanwhile: read the file anew
      if (r.ok) {
        const next = {
          ...rec, accessToken: r.access, accessExpiresAt: new Date(clock() + r.expiresIn * 1000).toISOString(),
          refreshToken: r.refresh !== null ? r.refresh : rec.refreshToken, refused: false, savedAt: new Date(clock()).toISOString(),
        };
        try { save(next); } catch { return { ok: false, why: "not_saved" }; }
        say(`${label} token refreshed`);
        return { ok: true, access: next.accessToken, guard: guardOf(next) };
      }
      if (r.why === "refused") {
        try { save({ ...rec, refused: true, savedAt: new Date(clock()).toISOString() }); } catch { /* the next refresh is refused again */ }
        say(`${label} refused the refresh; the owner must sign in again`);
        return { ok: false, why: "refused" };
      }
      say(`${label} refresh did not finish (${r.why})`);
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
          say(`${label} client not registered (${r.why})`);
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
        code_challenge_method: "S256", state, scope, resource: up.resource,
      });
      say(`${label} sign-in begun`);
      return { ok: true, url: `${up.origin}${paths.authorize}?${q}` };
    },

    // Takes the code back: { ok: true } (signed in, the file written) or { ok: false, why }.
    // The return address is a GET any website can make the owner's browser ask for, so a wrong
    // or missing state changes nothing: the sign-in under way stays for the real return (T85
    // finding 7). The matching state clears it at once, before anything else, so it is used once.
    async finish({ code, state } = {}) {
      const p = pending;
      const no = (why) => {
        say(`${label} sign-in refused (${why})`);
        return { ok: false, why };
      };
      if (p === null) return no("no_pending");
      if (typeof state !== "string" || !STATE_RE.test(state) || !timingSafeEqual(Buffer.from(state, "utf8"), Buffer.from(p.state, "utf8"))) return no("bad_state");
      pending = null;
      const t = clock();
      if (!(t >= p.at && t - p.at < PENDING_MS)) return no("expired");
      if (typeof code !== "string" || !codeRe.test(code)) return no("bad_code");
      const r = readTokens(await post(paths.token, form({
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
      say(`${label} signed in`);
      return { ok: true };
    },

    // Signs out: the file removed, the sign-in under way dropped. { ok: true }.
    forget() {
      pending = null;
      epoch += 1;
      try { unlinkSync(file); } catch { /* there was none */ }
      say(`${label} signed out`);
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
