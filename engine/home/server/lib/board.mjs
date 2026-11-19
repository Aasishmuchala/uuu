// ctx.board: talks to the board as the owner. In local mode a request with no
// Authorization header is the owner, so this helper never sends that header.
// An answer from the board is parsed here and never passed on to the browser as is.
import { HomeError } from "./errors.mjs";
import { httpRequest, parseJson } from "./httpclient.mjs";

export function boardOff() {
  // Words for the owner (M51 F17, M50 F18): Health shows the command.
  return new HomeError(502, "The board is switched off, so agents and tasks cannot be reached.",
    "Open Health to see how to start it.", "board_off");
}

// The board is up but did not answer in time (or is held after that): the words Health uses for a slow part, so the
// owner is not told to start what is already running (REVIEW-STRESS 3). Same code as boardOff: callers that treat the
// board as out of reach still do.
export function boardSlow() {
  return new HomeError(502, "The board is running but not answering, so agents and tasks cannot be reached.",
    "Restart the engine: engine stop, then engine start.", "board_off");
}

// Reads get `timeoutMs`; writes (POST, PATCH, PUT, DELETE) get `writeTimeoutMs`, as a comment write on a
// busy board can take longer than a read and must not be reported as "not answering" when it worked.
// After a read has timed out, reads fail at once with the same words for `holdMs` (S-faults-ceaa6100): a board that
// is up but hung would otherwise hold every page's every read for the whole timeout, one after another. A refused
// connection is not held (it fails at once anyway), and writes are never held. A read that confirms a write, and every
// read of an owner's action, skips the hold (REVIEW-STRESS 1): get(path, { held: false }), or the client unheld() gives.
export const SLOW_HOLD_MS = 5000;
export function createBoard({ baseUrl, ids, companyName, log = () => {}, holdMs = SLOW_HOLD_MS, timeoutMs = 8000, writeTimeoutMs = 20000 }) {
  let cachedCompanyId = null;
  let heldUntil = 0;

  async function call(method, path, body, held = true) {
    if (typeof path !== "string" || !path.startsWith("/api/") || path.includes("..")) {
      throw new Error(`board: refusing path ${path}`);
    }
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const read = method === "GET" || method === "HEAD";
    if (read && held && Date.now() < heldUntil) throw boardSlow();
    let res;
    try {
      res = await httpRequest(baseUrl + path, { method, headers, body, timeoutMs: read ? timeoutMs : writeTimeoutMs });
    } catch (e) {
      if (e && e.message === "timed out") {
        if (read) heldUntil = Date.now() + holdMs;
        throw boardSlow();
      }
      throw boardOff();
    }
    const where = path.split("?")[0];
    if (res.status >= 200 && res.status < 300) {
      const parsed = parseJson(res.text);
      if (parsed === undefined) {
        log(`board ${method} ${where} -> ${res.status}, answer was not JSON`);
        throw new HomeError(502, "The board gave an answer the home screen could not read.",
          "Try again in a minute. If it keeps happening, look at Health.", "board_bad_answer", { upstreamStatus: res.status });
      }
      return parsed;
    }
    log(`board ${method} ${where} -> ${res.status}`);
    if (res.status === 404) {
      throw new HomeError(404, "That is no longer on the board.", "Refresh the page.", "board_not_found", { upstreamStatus: 404 });
    }
    if (res.status === 409) {
      throw new HomeError(409, "This was already handled.", "Refresh the page to see where it stands.", "board_conflict", { upstreamStatus: 409 });
    }
    throw new HomeError(502, "The board could not do this just now.",
      "Try again in a minute. If it keeps happening, look at Health.", "board_error", { upstreamStatus: res.status });
  }

  const client = {
    // options: held (default true): false for a read that must reach the board even while reads are held.
    get: (path, { held = true } = {}) => call("GET", path, undefined, held),
    post: (path, body = {}) => call("POST", path, body),
    patch: (path, body = {}) => call("PATCH", path, body),
    put: (path, body = {}) => call("PUT", path, body),
    // async: the id from ids.json, else the company with the configured name.
    async companyId() {
      const fromIds = ids()?.companyId;
      if (fromIds) return fromIds;
      if (cachedCompanyId) return cachedCompanyId;
      const list = await call("GET", "/api/companies");
      const found = Array.isArray(list) ? list.find((c) => c.name === companyName) : null;
      if (!found) {
        throw new HomeError(409, "The company is not set up on the board yet.", "Run: engine setup", "no_company");
      }
      cachedCompanyId = found.id;
      return found.id;
    },
  };
  // The same client with every read unheld, for an owner's action (ctx.acting).
  client.unheld = () => ({ ...client, get: (path) => call("GET", path, undefined, false) });
  return client;
}
