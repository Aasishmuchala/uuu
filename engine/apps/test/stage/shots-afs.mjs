// Arch Film Studio on the stage (PLAN-APPS-ASTRYX T6): seed() drives the app through its own
// /trpc and /api/upload, as its page does, to a state worth showing; STILLS names each still of
// take-stills.mjs and how the page is brought to it (the address, then real keys and clicks).
//
// The state: two projects. The main one has 12 renders uploaded and analysed, 9 enhanced (two
// with a second version), 6 approved, 1 rejected, 4 masters, a storyboard of 6 shots, 4 clips
// made and 3 approved, and one clip still being made (the fake door holds it). The second has a
// film assembled. A third, fresh project has nothing in it. Every spend goes through the fake
// door, and nothing leaves the Mac.
import { readFileSync } from "node:fs";

export const SLUG = "arch-film-studio";
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function seed(stage, pictures, log = () => {}) {
  const { query, mutate, upload, door } = stage;
  door.setAllowance({ open: true, budget: 1_000_000, spent: 0 });
  const get = (id) => query("project.get", { id });

  // project.get every second (the page asks every 3 s; the app advances at most once in 3 s)
  // until pick(project) is truthy.
  async function until(id, pick, what, ms = 240_000) {
    const end = Date.now() + ms;
    let last;
    for (;;) {
      last = await get(id);
      const v = pick(last);
      if (v) return last;
      if (Date.now() > end) throw new Error(`Arch Film Studio: ${what} did not happen; ${JSON.stringify(last).slice(0, 800)}\n${stage.appLog()}`);
      await wait(1000);
    }
  }
  const latest = (img) => img.enhancements[img.enhancements.length - 1];
  const ok = (state) => state === "succeeded";
  const failedAny = (list) => list.find((x) => x?.state === "failed");

  async function newProject(name, sets) {
    const p = await mutate("project.create", { name });
    for (const set of sets) {
      await upload(`/api/upload?project=${encodeURIComponent(p.id)}`, readFileSync(set.render), { "x-file-name": encodeURIComponent(set.name) });
    }
    log(`  ${name}: ${sets.length} renders`);
    return p.id;
  }
  async function analyse(id) {
    const p = await get(id);
    if (p.images.length === 0) return;
    // Four at a time, and a failed one asked again (up to three times): the stand-in relay
    // matches each picture with ffmpeg, which is slow when twelve arrive at once.
    const settled = (x, ids) => ids.every((iid) => { const a = x.images.find((i) => i.id === iid).analysis; return a && a.state !== "running" && a.state !== "queued"; });
    for (let round = 0; round < 3; round += 1) {
      const now = await get(id);
      const todo = now.images.filter((i) => i.analysis?.state !== "succeeded").map((i) => i.id);
      if (todo.length === 0) return;
      for (let k = 0; k < todo.length; k += 4) {
        const ids = todo.slice(k, k + 4);
        await mutate("image.analyse", { projectId: id, imageIds: ids });
        await until(id, (x) => settled(x, ids), "the analysis");
      }
    }
    const left = (await get(id)).images.filter((i) => i.analysis?.state !== "succeeded");
    if (left.length) log(`  ${left.length} analyses failed: ${left[0].analysis?.error}`);
  }
  async function enhance(id, imageIds, revisionNote) {
    const before = new Map((await get(id)).images.map((i) => [i.id, i.enhancements.length]));
    await mutate("image.enhance", { projectId: id, imageIds, ...(revisionNote ? { revisionNote } : {}) });
    const p = await until(id, (x) => imageIds.every((iid) => {
      const one = x.images.find((i) => i.id === iid);
      const r = latest(one);
      return r && one.enhancements.length > before.get(iid) && ["succeeded", "failed"].includes(r.state);
    }), "the enhancements");
    const bad = failedAny(imageIds.map((iid) => latest(p.images.find((i) => i.id === iid))));
    if (bad) throw new Error(`Arch Film Studio: an enhancement failed: ${bad.error}`);
    return p;
  }
  async function decide(id, img, decision, note) {
    await mutate("image.decide", { projectId: id, imageId: img.id, runId: latest(img).id, decision, ...(note ? { note } : {}) });
  }
  async function masters(id, imageIds) {
    await mutate("image.master", { projectId: id, imageIds });
    const p = await until(id, (x) => imageIds.every((iid) => ["succeeded", "failed"].includes(x.images.find((i) => i.id === iid).master?.state)), "the masters");
    const bad = failedAny(imageIds.map((iid) => p.images.find((i) => i.id === iid).master));
    if (bad) throw new Error(`Arch Film Studio: a master failed: ${bad.error}`);
  }
  async function storyboard(id, brief) {
    await mutate("storyboard.create", { projectId: id, brief, format: "16:9" });
    const p = await until(id, (x) => x.storyboard && !["running", "queued"].includes(x.storyboard.state), "the storyboard");
    if (p.storyboard.state !== "succeeded") throw new Error(`Arch Film Studio: the storyboard failed: ${p.storyboard.error}`);
    return p.storyboard.shots;
  }
  async function clips(id, shotIds) {
    await mutate("shot.generate", { projectId: id, shotIds });
    const p = await until(id, (x) => shotIds.every((sid) => ["succeeded", "failed"].includes(x.storyboard.shots.find((s) => s.id === sid).video?.state)), "the clips");
    const bad = failedAny(shotIds.map((sid) => p.storyboard.shots.find((s) => s.id === sid).video));
    if (bad) throw new Error(`Arch Film Studio: a clip failed: ${bad.error}`);
  }

  const sets = pictures.sets;
  const pick = (n, from = 0) => Array.from({ length: n }, (_, i) => sets[(from + i) % sets.length]);

  // The fresh project first, so the main one is the newest (the one a page with no address opens).
  const fresh = (await mutate("project.create", { name: "Harbour house" })).id;

  // The second project: a film made end to end.
  log("  seeding the second project, to a finished film");
  const second = await newProject("East garden film", pick(4, 4));
  await analyse(second);
  let p2 = await get(second);
  const ids2 = p2.images.map((i) => i.id);
  p2 = await enhance(second, ids2);
  for (const img of p2.images) await decide(second, img, "approved");
  await masters(second, ids2);
  const shots2 = await storyboard(second, "A short, calm walk through the east garden, ending on the water wall.");
  await clips(second, shots2.map((s) => s.id));
  for (const s of shots2) await mutate("shot.decide", { projectId: second, shotId: s.id, decision: "approved" });
  await mutate("film.assemble", { projectId: second, transition: "fade" });
  p2 = await until(second, (x) => x.film && !["running", "queued"].includes(x.film.state), "the film", 300_000);
  if (p2.film.state !== "succeeded") throw new Error(`Arch Film Studio: the film failed: ${JSON.stringify(p2.film).slice(0, 400)}`);

  // The main project.
  log("  seeding the main project");
  const main = await newProject("Courtyard water garden", pick(12, 0));
  await analyse(main);
  let p = await get(main);
  const img = p.images;
  p = await enhance(main, img.slice(0, 9).map((i) => i.id));
  // Two pictures sent back once, each with a second version.
  const notes = ["Keep the stone darker and the water clearer.", "Less warmth in the sky, keep the clouds soft."];
  for (const [k, n] of [[0, notes[0]], [1, notes[1]]]) {
    const one = p.images.find((i) => i.id === img[k].id);
    await decide(main, one, "revision", n);
    p = await enhance(main, [one.id], n);
  }
  for (const k of [0, 1]) {
    const one = p.images.find((i) => i.id === img[k].id);
    if (one.enhancements.length < 2) throw new Error("Arch Film Studio: a second version was not made");
  }
  for (let k = 0; k < 6; k += 1) await decide(main, p.images.find((i) => i.id === img[k].id), "approved");
  await decide(main, p.images.find((i) => i.id === img[6].id), "rejected", "The cranes came out too dark.");
  await masters(main, img.slice(0, 4).map((i) => i.id));
  const shots = await storyboard(main, "Arrive at the water garden in the late morning, take in the wall and its cranes, end on the still pools.");
  await clips(main, shots.slice(0, 4).map((s) => s.id));
  for (const s of shots.slice(0, 3)) await mutate("shot.decide", { projectId: main, shotId: s.id, decision: "approved" });
  // One clip still being made: the door holds it running.
  door.holdNew(true);
  await mutate("shot.generate", { projectId: main, shotIds: [shots[4].id] });
  await until(main, (x) => x.storyboard.shots.find((s) => s.id === shots[4].id).video?.taskId, "the held clip reaching the door");
  door.holdNew(false);

  door.setAllowance({ open: true, budget: 2000, spent: 340 });
  return { main, second, fresh };
}

// The address of a screen of a project (the new layout's #/p/<id>/<screen>).
const at = (id, screen) => `#/p/${id}/${screen}`;

// Each still: its name, the screen it shows, and how the page is brought to it.
export const STILLS = [
  { name: "projects", screen: "Projects", run: (page) => page.open("#/", { clearStorage: true }) },
  { name: "overview", screen: "Overview", run: (page, c) => page.open(at(c.main, "overview")) },
  { name: "renders", screen: "Renders", run: (page, c) => page.open(at(c.main, "renders")) },
  { name: "renders-empty", screen: "Renders", run: (page, c) => page.open(at(c.fresh, "renders")) },
  {
    name: "enhance-selected", screen: "Enhance",
    run: async (page, c) => {
      await page.open(at(c.main, "enhance"));
      // The sheet's own picture buttons (aria-pressed); Shift-click selects the range: the eight
      // pictures from IMG-005 on, none with a locked master, so the bar shows its price ready.
      await page.clickNth("li > button[aria-pressed]", 4);
      await page.clickNth("li > button[aria-pressed]", 11, { shift: true });
    },
  },
  { name: "review-focus", screen: "Review", run: (page, c) => page.open(at(c.main, "review")) },
  { name: "review-grid", screen: "Review", run: async (page, c) => { await page.open(at(c.main, "review")); await page.settle(); await page.key("g"); } },
  { name: "review-revision-note", screen: "Review", run: async (page, c) => { await page.open(at(c.main, "review")); await page.settle(); await page.key("v"); } },
  { name: "masters", screen: "Masters", run: (page, c) => page.open(at(c.main, "masters")) },
  { name: "storyboard", screen: "Storyboard", run: (page, c) => page.open(at(c.main, "storyboard")) },
  { name: "film-preview", screen: "Film", run: (page, c) => page.open(at(c.main, "film")) },
  { name: "film-done", screen: "Film", run: (page, c) => page.open(at(c.second, "film")) },
  { name: "shortcuts", screen: "Shortcuts", run: async (page, c) => { await page.open(at(c.main, "overview")); await page.settle(); await page.key("?", { shift: true }); } },
  { name: "command-palette", screen: "Command palette", run: async (page, c) => { await page.open(at(c.main, "overview")); await page.settle(); await page.key("k", { meta: true }); } },
  {
    name: "allowance-closed", screen: "Enhance",
    before: (stage) => stage.door.setAllowance({ open: false }),
    run: (page, c) => page.open(at(c.main, "enhance")),
    after: (stage) => stage.door.setAllowance({ open: true }),
  },
];
