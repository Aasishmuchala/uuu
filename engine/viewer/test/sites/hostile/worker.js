// A worker (and a service worker) that tries the canaries from its own context.
const u = JSON.parse(new URLSearchParams(location.search).get("u") || "[]");
const go = () => Promise.all(u.map((x) => fetch(x, { mode: "no-cors" }).catch(() => {})));
go();
self.addEventListener("install", (e) => e.waitUntil(go()));
self.addEventListener("activate", (e) => e.waitUntil(go()));
