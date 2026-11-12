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

// Reads get `timeoutMs`; writes (POST, PATCH, PUT, DELETE) get `writeTimeoutMs`, as a comment write on a
// busy board can take longer than a read and must not be reported as "not answering" when it worked.
export function createBoard({ baseUrl, ids, companyName, log = () => {}, timeoutMs = 8000, writeTimeoutMs = 20000 }) {
  let cachedCompanyId = null;

  async function call(method, path, body) {
    if (typeof path !== "string" || !path.startsWith("/api/") || path.includes("..")) {
      throw new Error(`board: refusing path ${path}`);
    }
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      const limit = method === "GET" || method === "HEAD" ? timeoutMs : writeTimeoutMs;
      res = await httpRequest(baseUrl + path, { method, headers, body, timeoutMs: limit });
    } catch {
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

  return {
    get: (path) => call("GET", path),
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
}
