// Stub of the Frappe bench (port 8120) for tests. In memory, built-in modules only.
import http from "node:http";

const NAME_PREFIX = {
  "Sales Invoice": "ACC-SINV-2026-", "Purchase Invoice": "ACC-PINV-2026-", "Journal Entry": "ACC-JV-2026-",
  "Payment Entry": "ACC-PAY-2026-", "CRM Lead": "CRM-LEAD-2026-", "CRM Deal": "CRM-DEAL-2026-",
  Employee: "HR-EMP-", "Leave Application": "HR-LAP-2026-", Attendance: "HR-ATT-2026-",
  "FCRM Note": "FCRM-NOTE-", "CRM Task": "CRM-TASK-", "HD Ticket Comment": "HD-COMMENT-",
};
const NUMERIC_NAMES = new Set(["HD Ticket"]);

const nowStamp = () => new Date().toISOString().replace("T", " ").replace("Z", "");
const clone = (v) => (v === undefined ? v : structuredClone(v));

function loadState(seed) {
  const s = { users: {}, docs: {}, comments: [], missingDoctypes: [], submitRefusals: {} };
  if (seed) for (const [k, v] of Object.entries(clone(seed))) s[k] = v;
  return s;
}

function frappeError(status, excType, message) {
  return [status, { exc_type: excType, exception: `frappe.exceptions.${excType}: ${message}`, message }];
}

// What the real books answer to a validation refusal: HTTP 417, `exception` starting with the class and
// `_server_messages` as a JSON string of JSON strings (each with a `message`, which may hold HTML).
function frappeInvalid(message, doctype = "Leave Application") {
  return [417, {
    exception: `frappe.exceptions.ValidationError: ${message}`,
    exc_type: "ValidationError",
    _server_messages: JSON.stringify([JSON.stringify({ message, indicator: "red", title: "Message" })]),
    exc: JSON.stringify([`Traceback (most recent call last):\n  File "apps/frappe/frappe/handler.py", line 1, in handle\n${doctype}`]),
  }];
}

// SQL LIKE to RegExp (case-insensitive)
function likeRegex(pattern) {
  const src = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${src}$`, "is");
}

function compare(a, b) {
  const na = Number(a), nb = Number(b);
  if (a !== null && a !== "" && b !== null && b !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function matches(doc, [field, op, value]) {
  const v = doc[field];
  switch (String(op).toLowerCase()) {
    case "=": return String(v ?? "") === String(value ?? "");
    case "!=": return String(v ?? "") !== String(value ?? "");
    case "in": return (Array.isArray(value) ? value : String(value).split(",")).map(String).includes(String(v));
    case "not in": return !(Array.isArray(value) ? value : String(value).split(",")).map(String).includes(String(v));
    case "like": return likeRegex(value).test(String(v ?? ""));
    case "not like": return !likeRegex(value).test(String(v ?? ""));
    case ">": return v != null && compare(v, value) > 0;
    case "<": return v != null && compare(v, value) < 0;
    case ">=": return v != null && compare(v, value) >= 0;
    case "<=": return v != null && compare(v, value) <= 0;
    default: throw Object.assign(new Error(`unsupported filter operator ${op}`), { status: 400 });
  }
}

function parseFilters(raw) {
  if (!raw) return [];
  let f;
  try { f = JSON.parse(raw); } catch { throw Object.assign(new Error("filters is not valid JSON"), { status: 400 }); }
  if (Array.isArray(f)) return f.map((x) => (x.length === 4 ? x.slice(1) : x));
  return Object.entries(f).map(([k, v]) => (Array.isArray(v) ? [k, v[0], v[1]] : [k, "=", v]));
}

export async function startStubBench({ port = 0, seed } = {}) {
  const state = loadState(seed);
  const requests = [];

  const docsOf = (dt) => (state.docs[dt] ||= []);
  const nameOf = (d) => String(d.name);

  function nextName(dt, body) {
    const list = docsOf(dt);
    if (NUMERIC_NAMES.has(dt)) {
      return list.reduce((m, d) => Math.max(m, Number(d.name) || 0), 0) + 1;
    }
    if (dt === "Customer" || dt === "Supplier" || dt === "Item") {
      return body.customer_name || body.supplier_name || body.item_name || body.item_code || `${dt}-${list.length + 1}`;
    }
    const prefix = NAME_PREFIX[dt] || `${dt.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase()}-`;
    let n = list.length + 1;
    while (list.some((d) => nameOf(d) === `${prefix}${String(n).padStart(5, "0")}`)) n += 1;
    return `${prefix}${String(n).padStart(5, "0")}`;
  }

  function userFor(req) {
    const m = /^token +(\S+)$/i.exec(req.headers.authorization || "");
    if (!m) return null;
    return state.users[m[1]] ? { ...state.users[m[1]], key: m[1] } : null;
  }
  const canTouch = (user, dt) => user.doctypes?.includes("*") || user.doctypes?.includes(dt);

  async function handle(req, url, body, user) {
    const p = url.pathname;
    const method = req.method;
    if (method === "GET" && p === "/api/method/ping") return { message: "pong" };
    if (!user) return frappeError(401, "AuthenticationError", "Not logged in");

    if (method === "POST" && p === "/api/method/frappe.client.submit") {
      let doc = body?.doc;
      if (typeof doc === "string") { try { doc = JSON.parse(doc); } catch { doc = null; } }
      if (!doc || !doc.doctype || !doc.name) return frappeError(400, "ValidationError", "doc with doctype and name is required");
      if (state.missingDoctypes.includes(doc.doctype)) return frappeError(404, "DoesNotExistError", `DocType ${doc.doctype} not found`);
      if (!user.canSubmit || !canTouch(user, doc.doctype)) return frappeError(403, "PermissionError", `No permission to submit ${doc.doctype}`);
      const found = docsOf(doc.doctype).find((d) => nameOf(d) === String(doc.name));
      if (!found) return frappeError(404, "DoesNotExistError", `${doc.doctype} ${doc.name} not found`);
      const refusal = state.submitRefusals?.[doc.doctype];
      if (refusal) return frappeInvalid(refusal, doc.doctype);
      if (found.docstatus !== 0) return frappeError(417, "ValidationError", "Document is not a draft");
      found.docstatus = 1; found.modified = nowStamp();
      return { message: clone(found) };
    }

    if (method === "POST" && p === "/api/method/frappe.desk.form.utils.add_comment") {
      const b = body || {};
      for (const k of ["reference_doctype", "reference_name", "content"]) {
        if (!b[k]) return frappeError(400, "ValidationError", `${k} is required`);
      }
      const c = {
        name: `comment-${state.comments.length + 1}`, comment_type: "Comment",
        reference_doctype: b.reference_doctype, reference_name: b.reference_name, content: b.content,
        comment_email: b.comment_email ?? user.email, comment_by: b.comment_by ?? user.email,
        owner: user.email, creation: nowStamp(),
      };
      state.comments.push(c);
      return { message: clone(c) };
    }

    const m = /^\/api\/resource\/([^/]+)(?:\/([^/]+))?$/.exec(p);
    if (m) {
      const dt = decodeURIComponent(m[1]);
      const name = m[2] === undefined ? null : decodeURIComponent(m[2]);
      if (state.missingDoctypes.includes(dt)) return frappeError(404, "DoesNotExistError", `DocType ${dt} not found`);
      if (!canTouch(user, dt)) return frappeError(403, "PermissionError", `No permission for ${dt}`);

      if (name === null && method === "GET") {
        let list = docsOf(dt).filter((d) => parseFilters(url.searchParams.get("filters")).every((f) => matches(d, f)));
        const om = /^(.*?)\s*(asc|desc)?$/i.exec((url.searchParams.get("order_by") || "modified desc").trim());
        const field = om[1].replace(/`/g, "").split(".").pop();
        const dir = (om[2] || "asc").toLowerCase() === "desc" ? -1 : 1;
        list = [...list].sort((a, b) => dir * compare(a[field] ?? "", b[field] ?? ""));
        const lim = url.searchParams.has("limit_page_length") ? Number(url.searchParams.get("limit_page_length")) : 20;
        if (lim > 0) list = list.slice(0, lim);
        let fields = ["name"];
        const rawFields = url.searchParams.get("fields");
        if (rawFields) { try { fields = JSON.parse(rawFields); } catch { return frappeError(400, "ValidationError", "fields is not valid JSON"); } }
        const data = list.map((d) => (fields.includes("*") ? clone(d) : Object.fromEntries(fields.map((f) => [f, d[f] ?? null]))));
        return { data };
      }
      if (name === null && method === "POST") {
        if (!body || typeof body !== "object") return frappeError(400, "ValidationError", "A JSON body is required");
        const t = nowStamp();
        const doc = { ...clone(body), doctype: dt, name: nextName(dt, body), owner: user.email, docstatus: 0, creation: t, modified: t };
        docsOf(dt).push(doc);
        return { data: clone(doc) };
      }
      if (name !== null) {
        const found = docsOf(dt).find((d) => nameOf(d) === name);
        if (!found) return frappeError(404, "DoesNotExistError", `${dt} ${name} not found`);
        if (method === "GET") return { data: clone(found) };
        if (method === "PUT") {
          for (const [k, v] of Object.entries(body || {})) if (!["name", "owner", "docstatus", "creation", "doctype"].includes(k)) found[k] = clone(v);
          found.modified = nowStamp();
          return { data: clone(found) };
        }
        if (method === "DELETE") {
          if (!user.canDelete) return frappeError(403, "PermissionError", `No permission to delete ${dt}`);
          state.docs[dt] = docsOf(dt).filter((d) => d !== found);
          return { message: "ok" };
        }
      }
    }
    return [404, { exc_type: "NotFound", message: "Not found" }];
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    if (raw) {
      const ct = String(req.headers["content-type"] || "");
      if (ct.includes("application/x-www-form-urlencoded")) body = Object.fromEntries(new URLSearchParams(raw));
      else { try { body = JSON.parse(raw); } catch { body = raw; } }
    }
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: { ...req.headers }, body });
    let status = 200, out;
    try {
      out = await handle(req, url, body, userFor(req));
      if (Array.isArray(out) && out.length === 2 && typeof out[0] === "number") [status, out] = out;
    } catch (e) {
      status = e.status || 500;
      out = { exc_type: status === 400 ? "ValidationError" : "ServerError", message: e.message };
    }
    const text = JSON.stringify(out);
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
    res.end(text);
  });

  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const actualPort = server.address().port;
  return {
    url: `http://127.0.0.1:${actualPort}`, port: actualPort, state, requests,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
