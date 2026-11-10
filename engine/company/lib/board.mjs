// A small client for paperclip's board, used by apply. It talks to the board directly
// with NO Authorization header (in local mode that is the owner) and never reads or sets
// PAPERCLIP_API_URL. Errors carry one plain sentence; no token or body is ever printed.

export class BoardDown extends Error {}
export class BoardRefused extends Error {}

// Board messages are shown to the owner. Keep them short and strip anything token-shaped.
function cleanMessage(text) {
  return String(text || "")
    .replace(/pcp_[A-Za-z0-9_-]+/g, "<hidden>")
    .replace(/(bearer|token)\s+\S+/gi, "$1 <hidden>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
    .replace(/[.\s]+$/, "");
}

export function boardClient(baseUrl, { portLabel } = {}) {
  const writes = [];

  async function request(method, path, body, { what, allow404 = false } = {}) {
    const headers = { accept: "application/json" };
    const init = { method, headers, signal: AbortSignal.timeout(30000) };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(baseUrl + path, init);
    } catch {
      throw new BoardDown(`The board is not answering on port ${portLabel}. Run: engine start`);
    }
    if (method !== "GET") writes.push({ method, path });
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    if (res.status === 404 && allow404) return null;
    if (res.status >= 400) {
      const msg = cleanMessage(data && typeof data === "object" ? data.error || data.message : "");
      const err = new BoardRefused(`The board refused to ${what || `answer ${method} ${path}`}${msg ? `: ${msg}` : ""}.`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    writes,
    get: (path, opts) => request("GET", path, undefined, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    patch: (path, body, opts) => request("PATCH", path, body, opts),
    put: (path, body, opts) => request("PUT", path, body, opts),
  };
}
