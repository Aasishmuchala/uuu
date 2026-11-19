// Render to Film on the stage (PLAN-APPS-ASTRYX T6): seed() drives the app through its own
// procedures and /api/upload, as its page does, against the fakes; STILLS names each still of
// take-stills.mjs and how the page is brought to it.
//
// The state: one render with 8 stills across three looks (golden hour, blue hour, overcast),
// one with people and its people check, 3 clips, 3 favourites (the stored tag "favourite"
// through setTags) and other tags, a director storyboard planned over four renders with two
// frames shot, close-ups found and shot from a still, one location take, and an edit with the
// three clips on the timeline and one reply from the editor. Everything goes through the app's
// own procedures; no document is written by hand.
import { readFileSync } from "node:fs";

export const SLUG = "render-to-film";
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const MODEL = "nano-banana-pro";

const TAKES = [
  { look: "golden-hour", crowd: "none", direction: "Low sun raking across the stone, long soft shadows." },
  { look: "golden-hour", crowd: "few", direction: "A couple walking slowly along the pool edge." },
  { look: "golden-hour", crowd: "none", direction: "Warm light on the bronze cranes, water glowing." },
  { look: "blue-hour", crowd: "none", direction: "The lamps just on, the sky deep blue." },
  { look: "blue-hour", crowd: "none", direction: "Still water with the lamps reflected in it." },
  { look: "blue-hour", crowd: "none", direction: "Low sun raking across the stone, long soft shadows." },
  { look: "overcast", crowd: "none", direction: "Soft even light, wet paving after rain." },
  { look: "overcast", crowd: "none", direction: "" },
];

export async function seed(stage, pictures, log = () => {}) {
  const { query, mutate, upload, door } = stage;
  door.setAllowance({ open: true, budget: 1_000_000, spent: 0 });
  async function until(fn, what, ms = 240_000) {
    const end = Date.now() + ms;
    let last;
    for (;;) {
      last = await fn();
      if (last && last.ok) return last.value;
      if (Date.now() > end) throw new Error(`Render to Film: ${what} did not happen; ${JSON.stringify(last).slice(0, 600)}\n${stage.appLog()}`);
      await wait(1000);
    }
  }
  const still = async (id) => until(async () => {
    const s = await query("shotStatus", { id });
    if (s.done && s.status !== "SUCCEEDED") throw new Error(`Render to Film: a still failed: ${s.error}`);
    return { ok: s.done, value: s };
  }, `the still ${id}`);
  const clip = async (id) => until(async () => {
    const s = await query("videoStatus", { id });
    if (s.done && s.status !== "SUCCEEDED") throw new Error(`Render to Film: a clip failed: ${s.error}`);
    return { ok: s.done, value: s };
  }, `the clip ${id}`);
  const sets = pictures.sets;
  const put = async (set) => (await upload("/api/upload", readFileSync(set.render))).url;

  // The render, and eight stills of it across three looks.
  const render = sets[0];
  const renderUrl = await put(render);
  const size = { width: render.width, height: render.height };
  const stills = [];
  for (const t of TAKES) {
    const { id } = await mutate("createShot", { imageUrl: renderUrl, imageModel: MODEL, ...t, ...size });
    stills.push(id);
    await still(id);
  }
  log(`  ${stills.length} stills`);
  // The people check on the take with people.
  await mutate("checkShot", { stillId: stills[1] });
  await until(async () => {
    const c = await query("checkStatus", { stillId: stills[1] });
    return { ok: c && c.status !== "running", value: c };
  }, "the people check");

  // Three clips.
  const clips = [];
  for (const [i, direction] of [[0, "A slow push in toward the centre spout."], [3, "The camera drifts right along the wall."], [6, ""]]) {
    const { id } = await mutate("createVideo", { stillId: stills[i], direction });
    clips.push(id);
    await clip(id);
  }
  log(`  ${clips.length} clips`);

  // Favourites and tags, through setTags only.
  await mutate("setTags", { kind: "still", id: stills[0], tags: ["favourite", "client"] });
  await mutate("setTags", { kind: "still", id: stills[3], tags: ["favourite", "terrace"] });
  await mutate("setTags", { kind: "clip", id: clips[0], tags: ["favourite", "client"] });
  await mutate("setTags", { kind: "still", id: stills[6], tags: ["rain"] });

  // The director: a storyboard over four renders, two frames shot, three chosen.
  const boardSets = [sets[0], sets[1 % sets.length], sets[3 % sets.length], sets[4 % sets.length]];
  const images = [];
  for (const s of boardSets) images.push({ url: await put(s), width: s.width, height: s.height, name: s.name });
  const { id: board } = await mutate("storyboard.plan", { images, storyline: "golden-reveal", story: "", imageModel: MODEL });
  await until(async () => {
    const j = await query("storyboard.job", { id: board });
    if (j?.status === "failed") throw new Error(`Render to Film: the storyboard failed: ${j.error}`);
    return { ok: j?.status === "planned", value: j };
  }, "the storyboard");
  for (const image of [0, 1]) {
    const { id } = await mutate("storyboard.shoot", { id: board, image });
    await still(id);
  }
  await mutate("storyboard.pick", { id: board, images: [0, 1, 2] });
  log("  director storyboard");

  // Close-ups found in a still, then shot.
  const { id: found } = await mutate("closeups.find", { kind: "still", id: stills[0], count: 3, imageModel: MODEL });
  await until(async () => {
    const j = await query("closeups.job", { id: found });
    if (j?.status === "failed") throw new Error(`Render to Film: the close-up search failed: ${j.error}`);
    return { ok: j?.status === "picked", value: j };
  }, "the close-up search");
  await mutate("closeups.render", { id: found });
  const shot = await until(async () => {
    const j = await query("closeups.job", { id: found });
    return { ok: (j?.shots?.length ?? 0) > 0, value: j };
  }, "the close-up shots");
  for (const s of shot.shots) if (s.stillId) await still(s.stillId);
  log("  close-ups");

  // One location take from a "screenshot".
  const shotSet = sets[5 % sets.length];
  const loc = await mutate("location.create", { url: await put(shotSet), width: shotSet.width, height: shotSet.height, lat: 51.5072, lng: -0.1276, place: "Water garden, London" });
  await still(loc.id);

  // The edit: the three clips on the timeline, and one exchange with the editor.
  await mutate("edit.saveTimeline", {
    items: clips.map((clipId, i) => ({ key: `cut-${i + 1}`, clipId, sourceStart: 0, duration: 3 })),
    transition: "fade", fadeSeconds: 0.5,
  });
  await mutate("edit.agentSend", { text: "Make the cuts feel softer, it is a calm film." });
  await until(async () => {
    const e = await query("edit.project");
    return { ok: !e.agent && e.messages.length >= 2, value: e };
  }, "the editor's reply");
  log("  edit");
  // The library settles anything still pending.
  await query("library");
  door.setAllowance({ open: true, budget: 2000, spent: 340 });
  return { renderUrl, stills, clips, board };
}

// The Stills page keeps its takes in the page itself (the session's takes), so the workbench
// stills make their takes through the page: pick a look, press the priced "Make it cinematic"
// (the fake door answers), wait for the take to land. The next still reuses the page as it is.
// Marks one element for clickNth: the first match of `selector` whose first line of text is `text`.
const markByText = (page, selector, text) => page.evaluate(`(() => {
  document.querySelectorAll("[data-stage-pick]").forEach((e) => e.removeAttribute("data-stage-pick"));
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.innerText.trim().split("\\n")[0].trim() === ${JSON.stringify(text)});
  if (el) el.setAttribute("data-stage-pick", "1");
  return !!el; })()`);
// A Selector field by its label: its trigger, then the option whose name is `option`.
async function pickOption(page, field, option) {
  const marked = await page.evaluate(`(() => {
    document.querySelectorAll("[data-stage-pick]").forEach((e) => e.removeAttribute("data-stage-pick"));
    const label = [...document.querySelectorAll("label")].find((l) => l.innerText.trim().startsWith(${JSON.stringify(field)}));
    let box = label;
    while (box && !box.querySelector("button")) box = box.parentElement;
    const trigger = box && box.querySelector("button");
    if (trigger) trigger.setAttribute("data-stage-pick", "1");
    return !!trigger; })()`);
  if (!marked) throw new Error(`no field "${field}" on screen`);
  await page.clickNth("[data-stage-pick]", 0);
  if (!(await markByText(page, '[role="option"]', option))) throw new Error(`no option "${option}" in "${field}"`);
  await page.clickNth("[data-stage-pick]", 0);
}
const READY = `document.querySelectorAll('[aria-label$=", ready"]').length`;
async function makeTake(page, look) {
  await pickOption(page, "Cinematic look", look);
  const before = await page.evaluate(READY);
  // The priced button reads "Make it cinematic" for the first take, "Make another take" after.
  const make = `[...document.querySelectorAll("button")].find((b) => ["Make it cinematic", "Make another take"].includes(b.innerText.trim()) && b.getAttribute("aria-disabled") !== "true" && !b.disabled)`;
  if (!(await page.waitFor(`!!${make}`, 30_000))) throw new Error("the priced button was not ready");
  await page.click(await page.evaluate(`${make}.innerText.trim()`));
  if (!(await page.waitFor(`${READY} > ${before}`, 120_000))) throw new Error(`the ${look} take did not land`);
}
// The Library, once its grid is on screen.
async function openLibrary(page) {
  await page.open("#library");
  if (!(await page.waitFor(`document.querySelectorAll('button[aria-label^="Select "]').length > 3`, 15_000))) throw new Error("the Library grid did not show");
}

// The new layout keeps today's addresses (#stills, #video, ...), plus #favourites and #history.
// Library grid: each item is a button named by its title; its tick is "Select <title>".
export const STILLS = [
  {
    name: "stills-workbench", screen: "Stills",
    run: async (page) => {
      await page.open("#stills");
      await page.settle();
      for (const look of ["Soft overcast", "Blue hour", "Golden hour"]) await makeTake(page, look);
    },
  },
  { name: "stills-compare-render", screen: "Stills", run: async (page) => { await page.click("Compare with render"); } },
  {
    name: "compare-board", screen: "Library",
    run: async (page) => {
      await openLibrary(page);
      await page.click("Select Golden hour, 2K");
      await page.click("Select Blue hour, 2K");
      await page.click("Select Soft overcast, 2K");
      await page.key("c");
    },
  },
  { name: "video-workbench", screen: "Video", run: (page) => page.open("#video") },
  { name: "director", screen: "Director", run: (page) => page.open("#director") },
  { name: "closeups", screen: "Close-ups", run: (page) => page.open("#closeups") },
  { name: "location", screen: "Location", run: (page) => page.open("#location") },
  { name: "edit", screen: "Edit", run: (page) => page.open("#edit") },
  { name: "library", screen: "Library", run: (page) => page.open("#library") },
  {
    name: "library-selected", screen: "Library",
    run: async (page) => {
      await openLibrary(page);
      await page.click("Select Golden hour, 2K");
      await page.click("Select Blue hour, 2K");
      await page.click("Select Soft overcast, 2K");
    },
  },
  { name: "library-lightbox", screen: "Library", run: async (page) => { await openLibrary(page); await page.click("Golden hour, 2K"); } },
  { name: "favourites", screen: "Favourites", run: (page) => page.open("#favourites") },
  { name: "history", screen: "History", run: (page) => page.open("#history") },
  { name: "shortcuts", screen: "Shortcuts", run: async (page) => { await page.open("#library"); await page.settle(); await page.key("?", { shift: true }); } },
  { name: "command-palette", screen: "Command palette", run: async (page) => { await page.open("#library"); await page.settle(); await page.key("k", { meta: true }); } },
  {
    name: "allowance-closed", screen: "Stills",
    before: (stage) => stage.door.setAllowance({ open: false }),
    run: (page) => page.open("#stills"),
    after: (stage) => stage.door.setAllowance({ open: true }),
  },
];
