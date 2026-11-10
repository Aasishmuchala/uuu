// Method + pattern routing. Pattern segments are literal or `:name`; matching is by whole segments.
export function createRouter() {
  const routes = [];

  function add(method, pattern, handler, owner = null) {
    if (typeof pattern !== "string" || !pattern.startsWith("/")) throw new Error(`route pattern must start with /: ${pattern}`);
    if (typeof handler !== "function") throw new Error(`route ${method} ${pattern} has no handler`);
    const segs = pattern.split("/").slice(1);
    const shape = segs.map((s) => (s.startsWith(":") ? ":" : s)).join("/");
    if (routes.some((r) => r.method === method && r.shape === shape)) {
      throw new Error(`route ${method} ${pattern} is already taken`);
    }
    routes.push({ method, pattern, segs, shape, handler, owner });
  }

  function removeOwner(owner) {
    for (let i = routes.length - 1; i >= 0; i--) if (routes[i].owner === owner) routes.splice(i, 1);
  }

  // -> { handler, params } | { allowed: [methods] } | null
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
      if (r.method === method) return { handler: r.handler, params };
      allowed.push(r.method);
    }
    return allowed.length ? { allowed } : null;
  }

  return { add, removeOwner, match };
}
