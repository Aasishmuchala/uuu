// (f) Page-arrival motion (styles/base.css u-page-enter, 180 ms) right after a move to another page: the running
// animations and the arrival animation's own duration as the page computes it; data-motion; whether this engine
// parsed the style sheets' prefers-reduced-motion rules and what matchMedia answers.
await quiet(6000);
location.hash = INJ.to || "#/tasks";
await sleep(30);
const kids = [...document.querySelectorAll(".s-content > *")];
const anims = document.getAnimations ? document.getAnimations().filter((a) => a.playState === "running").map((a) => ({ name: a.animationName || a.constructor.name, ms: a.effect?.getComputedTiming?.().duration })) : null;
const first = kids[0] ? getComputedStyle(kids[0]) : null;
let parsedReduce = 0;
for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) if (r.media && /prefers-reduced-motion/.test(r.conditionText || r.media.mediaText)) parsedReduce++; } catch { /* other origin */ } }
await quiet(2000);
return {
  dataMotion: document.documentElement.getAttribute("data-motion"),
  matchMediaReduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
  arrival: first ? { name: first.animationName, duration: first.animationDuration } : null,
  running: anims, parsedReduceRules: parsedReduce,
};
