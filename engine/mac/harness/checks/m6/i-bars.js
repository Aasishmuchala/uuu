// (i) Scroll edges and bars: overscroll-behavior on the root, the body and the main scroller; every sticky element
// and where it stands after the main scroller is moved 600 px (it must still be inside the window); at this width,
// whether the phone's tab bar (.s-tabbar) shows.
if (INJ.wait) await waitFor(INJ.wait, 30000);
await quiet(8000);
const ob = (e) => e ? { x: getComputedStyle(e).overscrollBehaviorX, y: getComputedStyle(e).overscrollBehaviorY } : null;
const cands = [document.scrollingElement, ...document.querySelectorAll("body *")].filter((e) => e && (e === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(e).overflowY)) && e.scrollHeight - e.clientHeight > 100)
  .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
const sc = cands[0] || null;
const sticky = [...document.querySelectorAll("body *")].filter((e) => getComputedStyle(e).position === "sticky" && visible(e));
const before = sticky.map((e) => Math.round(e.getBoundingClientRect().top));
if (sc) { sc.scrollTop = Math.min(600, sc.scrollHeight - sc.clientHeight); await frame(); await sleep(150); }
const after = sticky.map((e) => { const r = e.getBoundingClientRect(); return { el: label(e), top: getComputedStyle(e).top, before: null, at: Math.round(r.top), inWindow: r.bottom > 0 && r.top < innerHeight }; });
after.forEach((a, i) => { a.before = before[i]; });
if (sc) sc.scrollTop = 0;
const tab = document.querySelector(".s-tabbar");
return { width: innerWidth, root: ob(document.documentElement), body: ob(document.body), scroller: sc ? { el: sc === document.scrollingElement ? "document" : label(sc), ...ob(sc), scrollbarGutter: getComputedStyle(sc).scrollbarGutter } : null,
  sticky: after, tabbar: tab ? { shown: visible(tab), display: getComputedStyle(tab).display } : "none on the page", wider: document.documentElement.scrollWidth > innerWidth };
