// A thin front for the stub board that behaves like the real board in the places where the
// stub is looser (read from paperclip 2026.1106.0, server/dist/routes/agents.js):
// - with owner approval switched on, POST /companies/:id/agents is refused with 409 and new
//   agents come only through POST /companies/:id/agent-hires, which answers { agent, approval };
// - PUT .../instructions-bundle/file needs `path` and `baseRevisionId` in the body (422 otherwise);
// - PATCH /agents/:id with `permissions` is refused with 422.
// `refuse` lists extra refusals for tests: [{ method, pattern: RegExp, status, error }]; the
// list is read on every request, so a test may empty it between runs.
// `after({ method, path, status })` runs once a forwarded request has been answered, so a test
// can make the board misbehave afterwards.
import http from "node:http";

export async function startStrictBoard(stub, { refuse = [], after = null } = {}) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const path = new URL(req.url, "http://x").pathname;
    seen.push({ method: req.method, path, headers: { ...req.headers } });
    const send = (status, payload) => {
      const text = JSON.stringify(payload);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(text);
    };
    for (const r of refuse) {
      if (r.method === req.method && r.pattern.test(path)) return send(r.status, { error: r.error });
    }
    let m = /^\/api\/companies\/([^/]+)\/agents$/.exec(path);
    if (req.method === "POST" && m) {
      const c = stub.state.companies.find((x) => x.id === m[1]);
      if (c && c.requireBoardApprovalForNewAgents) {
        return send(409, { error: "Direct agent creation requires board approval. Use POST /api/companies/:companyId/agent-hires to create a pending hire approval." });
      }
    }
    let target = req.url;
    let wrapHire = false;
    m = /^\/api\/companies\/([^/]+)\/agent-hires$/.exec(path);
    if (req.method === "POST" && m) { target = `/api/companies/${m[1]}/agents`; wrapHire = true; }
    if (req.method === "PUT" && /\/instructions-bundle\/file$/.test(path)) {
      if (!body || typeof body.path !== "string" || !("baseRevisionId" in body)) {
        return send(422, { error: "Read the entry and supply baseRevisionId (null for a new entry)" });
      }
    }
    if (req.method === "PATCH" && /^\/api\/agents\/[^/]+$/.test(path) && body && "permissions" in body) {
      return send(422, { error: "Use /api/agents/:id/permissions for permission changes" });
    }
    const headers = { ...req.headers };
    delete headers.host;
    delete headers["content-length"];
    const r = await fetch(stub.url + target, { method: req.method, headers, body: raw || undefined });
    const text = await r.text();
    if (after) after({ method: req.method, path, status: r.status });
    if (wrapHire && r.status < 300) return send(201, { agent: JSON.parse(text), approval: null });
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(text);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`, port, seen,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
