// Hash addresses: #/inbox, #/goals, #/goals/<id>, #/company, #/books ... #/health, #/search?q=
import { useEffect, useState } from "../vendor/preact-htm.js";

export function parseHash(hash = location.hash) {
  const raw = String(hash || "").replace(/^#/, "") || "/inbox";
  const [path, qs] = raw.split("?");
  const parts = path.split("/").filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  return { parts: parts.length ? parts : ["inbox"], query: new URLSearchParams(qs || "") };
}

export function go(address) {
  if (location.hash !== address) location.hash = address;
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
