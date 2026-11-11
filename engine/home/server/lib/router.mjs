// Method + pattern routing. Pattern segments are literal or `:name`; matching is by whole segments.
// A POST or DELETE route may name its own body limit (C3 33.1): `{ maxBody }`, whole bytes up to 16 MB.
export const MAX_ROUTE_BODY = 16 * 1024 * 1024;

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler, owner = null, options = undefined) {
    if (typeof pattern !== "string" || !pattern.startsWith("/")) throw new Error(`route pattern must start with /: ${pattern}`);
    if (typeof handler !== "function") throw new Error(`route ${method} ${pattern} has no handler`);
    let maxBody = null;
    if (options !== undefined) {
      if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error(`route ${method} ${pattern}: options must be { maxBody }`);
      if (options.maxBody !== undefined) {
        const n = options.maxBody;
        if (!Number.isInteger(n) || n < 1 || n > MAX_ROUTE_BODY) {
          throw new Error(`route ${method} ${pattern}: maxBody must be a whole number of bytes from 1 to ${MAX_ROUTE_BODY}`);
        }
        maxBody = n;
      }
    }
    const segs = pattern.split("/").slice(1);
    const shape = segs.map((s) => (s.startsWith(":") ? ":" : s)).join("/");
    if (routes.some((r) => r.method === method && r.shape === shape)) {
      throw new Error(`route ${method} ${pattern} is already taken`);
    }
    routes.push({ method, pattern, segs, shape, handler, owner, maxBody });
  }

  function removeOwner(owner) {
    for (let i = routes.length - 1; i >= 0; i--) if (routes[i].owner === owner) routes.splice(i, 1);
  }

  // -> { handler, params, maxBody } | { allowed: [methods] } | null   (maxBody is null for the default)
  function match(method, pathname) {
    const parts = pathname.split("/").slice(1);
    const allowed = [];
    for (const r of routes) {
      if (r.segs.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const s = r.segs[i];
        if (s.startsWith(":")) {
          if (!parts[i]) { ok = false; break; }
          try { params[s.slice(1)] = decodeURIComponent(parts[i]); } catch { ok = false; break; }
        } else if (s !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      if (r.method === method) return { handler: r.handler, params, maxBody: r.maxBody };
      allowed.push(r.method);
    }
    return allowed.length ? { allowed } : null;
  }

  return { add, removeOwner, match };
}
