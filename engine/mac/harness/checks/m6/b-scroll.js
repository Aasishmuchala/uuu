// (b) Scrolling at 1280: the page's main scroller (the scrolling element, or the tallest box that scrolls) is moved
// 24 px a frame for 150 frames on requestAnimationFrame; the gaps between frames are reported (median, p90, max).
if (INJ.wait) await waitFor(INJ.wait, 30000);
await quiet(8000);
const cands = [document.scrollingElement, ...document.querySelectorAll("body *")].filter((e) => {
  if (!e) return false;
  if (e !== document.scrollingElement && !/(auto|scroll)/.test(getComputedStyle(e).overflowY)) return false;
  return e.scrollHeight - e.clientHeight > 100;
}).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
const sc = cands[0] || null;
if (!sc) return { scroller: null, range: 0, note: "nothing on this page scrolls at this size" };
const range = sc.scrollHeight - sc.clientHeight;
sc.scrollTop = 0; await frame();
const t = [];
await new Promise((done) => {
  let n = 0;
  const tick = (now) => { t.push(now); sc.scrollTop = Math.min(range, sc.scrollTop + 24); if (++n < 150 && sc.scrollTop < range) requestAnimationFrame(tick); else done(); };
  requestAnimationFrame(tick);
  setTimeout(done, 8000);
});
const gaps = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
const at = (q) => gaps.length ? Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] * 10) / 10 : null;
return { scroller: sc === document.scrollingElement ? "document" : label(sc), range, frames: t.length, medianMs: at(0.5), p90Ms: at(0.9), maxMs: at(1), over17: gaps.filter((g) => g > 17.5).length };
