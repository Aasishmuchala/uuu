// (l) The Brain tab of Files (brain/find.js, brain/links-view.js), driven from inside the page: typing and Enter in
// the search box, the results with their passages and source lines, the "Not found in the brain:" line, opening a
// result, the links view of a name, and Back and Forward between Files and the Brain keeping ?tab=brain.
// INJ.mode "flow" (1280) does all that; "layout" (390) measures a results page at a phone's width.
const out = { steps: [] };
const step = (name, ok, more) => out.steps.push({ name, ok: !!ok, ...(more || {}) });
const box = await waitFor(".p-brain-find__form input", 20000);
const hash = () => decodeURIComponent(location.hash);
const results = () => [...document.querySelectorAll(".p-brain-find__result")];
if (INJ.mode === "layout") {
  await waitFor(".p-brain-find__result", 15000);
  await quiet(4000);
  const clipped = [...document.querySelectorAll(".p-brain-find *")].filter((e) => {
    if (!visible(e) || e.children.length) return false;
    const r = e.getBoundingClientRect();
    return r.right > innerWidth + 1 || r.left < -1 || (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== "visible");
  }).map((e) => `${label(e)} "${text(e, 40)}"`);
  return { width: innerWidth, results: results().length, wider: document.documentElement.scrollWidth > innerWidth, clipped: clipped.slice(0, 10), formWidth: Math.round(document.querySelector(".p-brain-find__form")?.getBoundingClientRect().width || 0) };
}
step("search box present", box, { placeholder: box?.getAttribute("placeholder") });
if (!box) return out;
async function ask(words) {
  const input = document.querySelector(".p-brain-find__form input");
  typeInto(input, words);
  // The page keeps the words in its own state on the input event; let it draw them before submitting.
  await waitUntil(() => input.value === words, 2000); await frame(); await sleep(150);
  // Enter as a script sends it does not submit a form in any engine; the page's form is submitted as Enter would.
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  const form = input.closest("form");
  if (!new RegExp(`ask=${encodeURIComponent(words).replace(/%20/g, "(%20|\\+| )")}`).test(location.hash)) form.requestSubmit();
  await waitUntil(() => hash().includes(`ask=${words}`) || location.hash.includes(`ask=${encodeURIComponent(words)}`), 5000);
  await quiet(6000);
  await waitUntil(() => document.querySelector(".p-brain-find__result, .p-brain-find__empty, .p-brain-find__missing"), 10000);
}
await ask("refunds");
const rs = results();
const card = rs[0];
step("results for refunds", rs.length > 0, { count: rs.length, hash: hash(),
  first: card ? { title: text(card.querySelector(".p-brain-find__card-title"), 60), place: text(card.querySelector(".p-brain-find__place"), 60), snippet: text(card.querySelector(".p-brain-find__text"), 80), source: text(card.querySelector(".p-brain-find__source"), 80), sourceLink: card.querySelector(".p-brain-find__source-link")?.getAttribute("href") ?? null } : null,
  everyCardHasSource: rs.every((r) => r.querySelector(".p-brain-find__source")), everyCardHasText: rs.every((r) => r.querySelector(".p-brain-find__text")) });
step("address keeps tab=brain and the words", /tab=brain/.test(location.hash) && /ask=refunds/.test(location.hash), { hash: hash() });
await ask("Priya zebra");
const missing = document.querySelector(".p-brain-find__missing");
step("not-found line", missing && /zebra/.test(missing.textContent), { line: text(missing, 120), results: results().length });
await ask("refunds");
const link = document.querySelector(".p-brain-find__source-link");
const atBrain = location.hash;
if (link) {
  link.click();
  await waitUntil(() => location.hash !== atBrain, 5000); await quiet(5000);
  step("open a result", location.hash !== atBrain, { href: link.getAttribute("href"), now: hash(), heading: text(document.querySelector("h1, h2"), 60) });
  history.back();
  await waitUntil(() => location.hash === atBrain, 5000); await quiet(5000);
  step("Back returns to the Brain", location.hash === atBrain && !!document.querySelector(".p-brain-find__form"), { now: hash(), results: results().length });
  history.forward();
  await waitUntil(() => location.hash !== atBrain, 5000); await quiet(4000);
  step("Forward goes to the result again", location.hash !== atBrain, { now: hash() });
  history.back();
  await waitUntil(() => location.hash === atBrain, 5000); await quiet(4000);
} else step("open a result", false, { why: "no source link on the first card" });
// Files and back: the Files part of the segmented control, then Back.
const filesTab = [...document.querySelectorAll("a, button, [role=radio], [role=tab]")].find((e) => visible(e) && /^files$/i.test(text(e, 20)));
if (filesTab) {
  filesTab.click();
  await waitUntil(() => !/tab=brain/.test(location.hash), 5000); await quiet(4000);
  const left = hash();
  history.back();
  await waitUntil(() => /tab=brain/.test(location.hash), 5000); await quiet(4000);
  step("Files then Back keeps ?tab=brain", /tab=brain/.test(location.hash) && !!document.querySelector(".p-brain-find"), { files: left, back: hash() });
} else step("Files then Back keeps ?tab=brain", false, { why: "no Files control found" });
await ask("Acme Interiors");
const chip = document.querySelector(".p-brain-find__chip");
if (chip) {
  chip.click();
  await waitFor(".p-brain-find__entity-name", 8000); await quiet(4000);
  const name = document.querySelector(".p-brain-find__entity-name");
  step("links view", !!name, { name: text(name, 60), linked: document.querySelectorAll(".p-brain-find__linked-item").length, hash: hash(), focused: label(document.activeElement) });
  const back = document.querySelector(".p-brain-find__back button");
  if (back) { back.click(); await waitFor(".p-brain-find__form", 6000); await quiet(3000); step("links view Back", !!document.querySelector(".p-brain-find__form"), { hash: hash() }); }
} else step("links view", false, { why: "no name chip for Acme Interiors" });
out.consoleHint = "console errors are counted by the probe";
return out;
