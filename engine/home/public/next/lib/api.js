// The only way the interface talks to anything: the home server's API (CONTRACTS 9), same origin.
// Every failure becomes an ApiError with a plain `message` and `next`, never a code or a stack.
import { useCallback, useEffect, useRef, useState } from "../vendor/preact-htm.js";

const NOT_ANSWERING = {
  message: "The engine is not answering.",
  next: "Run: engine start",
  code: "offline",
};
const NOT_UNDERSTOOD = {
  message: "The home screen got an answer it did not understand.",
  next: "Try again. If it keeps happening, restart the engine with: engine stop, then engine start.",
  code: "bad_answer",
};

export class ApiError extends Error {
  constructor(e, status) {
    super(e.message);
    this.next = e.next || "";
    this.code = e.code || "error";
    this.status = status;
    this.offline = e.code === "offline";
  }
}

async function request(method, path, body) {
  const headers = { Accept: "application/json" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-Engine"] = "1";
  }
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(NOT_ANSWERING, 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = data && data.error && data.error.message ? data.error : res.status >= 502 ? NOT_ANSWERING : NOT_UNDERSTOOD;
    throw new ApiError(e, res.status);
  }
  if (data === null || typeof data !== "object") throw new ApiError(NOT_UNDERSTOOD, res.status);
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  del: (path) => request("DELETE", path),
};

// Calls `fn` every `ms` while the tab is visible, and once as soon as it becomes visible again.
export function useVisibleInterval(fn, ms) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!ms) return undefined;
    const tick = () => { if (document.visibilityState === "visible") saved.current(); };
    const id = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms]);
}

// Loads one API path. `every` refreshes it quietly (no placeholder, the old answer stays on screen).
// Returns { data, error, loading, reload, refresh }.
export function useResource(path, { every = 0 } = {}) {
  const [s, setS] = useState({ data: null, error: null, loading: !!path });
  const seq = useRef(0);

  const load = useCallback(async (quiet) => {
    if (!path) return;
    const n = ++seq.current;
    if (!quiet) setS((p) => ({ data: p.data, error: null, loading: true }));
    try {
      const data = await api.get(path);
      if (n === seq.current) setS({ data, error: null, loading: false });
    } catch (error) {
      if (n !== seq.current) return;
      // A quiet refresh that fails keeps what is on screen; a fresh load shows the error.
      setS((p) => (quiet && p.data ? { ...p, loading: false } : { data: null, error, loading: false }));
    }
  }, [path]);

  useEffect(() => {
    setS({ data: null, error: null, loading: !!path });
    load(false);
  }, [path]);

  useVisibleInterval(() => load(true), every);

  return { ...s, reload: () => load(false), refresh: () => load(true) };
}
