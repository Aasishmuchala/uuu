// The stand-in app's service worker (frames trial): once installed it reaches for the stand-in internet, in the
// worker's own context, where the page's frame and its sandbox are no longer in the way.
const O = new URL(location.href).searchParams.get("o");
self.addEventListener("install", (e) => {
  e.waitUntil(fetch(`${O}/sw-install`, { mode: "no-cors" }).catch(() => null).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(fetch(`${O}/sw-activate`, { mode: "no-cors" }).catch(() => null));
});
