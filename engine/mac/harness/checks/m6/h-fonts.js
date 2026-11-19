// (h) Fonts: for the font stacks the page uses (body, headings, buttons, code, the shot's first row), the first family
// of each stack this engine really has (a canvas width test against two fallbacks), and the top of the shot's first
// row in the page (INJ.first, as the cook harness's page-measure.mjs reads it).
if (INJ.wait) await waitFor(INJ.wait, 30000);
await quiet(8000);
if (document.fonts) await document.fonts.ready;
const cv = document.createElement("canvas").getContext("2d");
const SAMPLE = "Mmwl1Iy@Q The quick brown fox 0123456789";
const width = (f) => { cv.font = `32px ${f}`; return cv.measureText(SAMPLE).width; };
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-monospace|ui-sans-serif|ui-serif|ui-rounded|-apple-system|BlinkMacSystemFont)$/i;
const has = (fam) => {
  if (GENERIC.test(fam)) return true;
  const q = /\s/.test(fam) && !/^["']/.test(fam) ? `"${fam}"` : fam;
  return width(`${q}, monospace`) !== width("monospace") || width(`${q}, serif`) !== width("serif");
};
const resolveStack = (stack) => {
  const fams = stack.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
  return fams.find(has) || null;
};
const pick = { body: document.body, h1: document.querySelector("h1"), h2: document.querySelector("h2"), button: document.querySelector("button"),
  input: document.querySelector("input, textarea"), code: document.querySelector("code, pre, kbd"), first: INJ.first ? document.querySelector(INJ.first) : null };
const fonts = {};
for (const [k, e] of Object.entries(pick)) if (e) { const ff = getComputedStyle(e).fontFamily; fonts[k] = { stack: ff.slice(0, 160), resolved: resolveStack(ff), weight: getComputedStyle(e).fontWeight, size: getComputedStyle(e).fontSize }; }
const f = pick.first;
return { fonts, first: INJ.first || null, firstRowTop: f ? Math.round(f.getBoundingClientRect().top + scrollY) : null, faces: document.fonts ? [...document.fonts].map((x) => `${x.family} ${x.weight} ${x.status}`).slice(0, 20) : [] };
