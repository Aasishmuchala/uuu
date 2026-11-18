// The body of an async function run in the page after a shot's steps (put into checks/steps.js by run-webkit.mjs):
// whether the page is wider than the window, the five widest things past it (the cook harness's LOOK), how many
// frames are on the page and from where, and the focused element. Returns plain data.
const d = document.documentElement;
const wide = [...document.querySelectorAll("body *")]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== "fixed"; })
  .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right).slice(0, 5)
  .map((e) => e.tagName.toLowerCase() + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + " " + Math.round(e.getBoundingClientRect().right));
const frames = [...document.querySelectorAll("iframe")].map((f) => String(f.getAttribute("src") || "").slice(0, 200));
return {
  overflow: d.scrollWidth > innerWidth,
  scrollWidth: d.scrollWidth,
  innerWidth,
  wide,
  frames,
  focus: document.activeElement ? document.activeElement.tagName.toLowerCase() : null,
};
