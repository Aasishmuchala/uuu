// (n) App Studio with the Astryx-kit app (scenes/apps.mjs astryx-app): what the home page shows where the app's
// frame goes, and whether the home screen itself uses scroll-craft (data-sc-*, a scroll-craft class or script).
await quiet(8000);
const frames = [...document.querySelectorAll("iframe")].map((f) => ({ src: f.getAttribute("src"), h: Math.round(f.getBoundingClientRect().height) }));
const sc = document.querySelectorAll("[data-sc-src], [data-sc-sequence], [class*=sc-], [data-scroll-craft]").length;
const scripts = [...document.scripts].map((s) => s.src).filter((s) => /scroll-?craft/i.test(s));
return { path: location.hash, frames, notice: text(document.querySelector(".p-app__notice, .p-app, main"), 200), scrollCraftNodes: sc, scrollCraftScripts: scripts };
