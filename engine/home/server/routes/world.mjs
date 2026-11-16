// PLAN-3D 2.2 (T4): GET /api/world, what the Map and Needs you draw as the lit studio: the departments as rooms with
// their agents, the three doors, App Studio and its apps, and one line of what was spent today. Read only: it is built
// from the same builders the Map, Settings and App Studio read (routes/map.mjs, routes/web.mjs, routes/generation.mjs,
// lib/apps.mjs), writes no file, changes no switch and has no POST. With the board off it answers 200; a part that
// cannot be read answers its "off" shape. Strings are cut to the sizes their source routes use and never escaped here.
import { loadDepartments, departmentLoad } from "../lib/departments.mjs";
import { HOST_SENTENCES, buildAppsView } from "../lib/apps.mjs";
import { LEDGER_SENTENCES, dollars } from "../lib/generation.mjs";
import { loadCatalogue } from "../lib/jobs.mjs";
import { agentCards, loadRoles } from "../lib/team.mjs";
import { DOOR_SENTENCES as GEN_DOOR_SENTENCES, HF_SENTENCES, buildGenerationView } from "./generation.mjs";
import { companyName, cut, taskModel } from "./map.mjs";
import { DOOR_SENTENCES as WEB_DOOR_SENTENCES, webSwitchOf } from "./web.mjs";

// The sizes /api/map uses: a company's or an agent's name 80, a task's title 120.
const NAME_MAX = 80;
const TITLE_MAX = 120;
const DOOR_TITLES = { web: "Web door", generation: "Generation door", higgsfield: "Higgsfield door" };
// Who goes through each door, named only where that role is in the company file.
const DOOR_AGENTS = { web: ["researcher"], generation: ["artist"], higgsfield: ["artist"] };

// A part that cannot be read answers this instead of failing the whole route.
async function orElse(read, off, ctx, what) {
  try {
    return await read();
  } catch (e) {
    ctx.log(`world: ${what} could not be read (${String(e?.message || e).split("\n")[0].slice(0, 200)})`);
    return off;
  }
}

function roomsOf(ctx, tctx) {
  const { departments } = loadDepartments(ctx.config);
  const catalogue = loadCatalogue(ctx.config);
  const cards = agentCards(ctx, tctx);
  const goalOf = (id) => (id && tctx ? tctx.goals.find((g) => g.id === id) : null) || null;
  return departments.map((d) => {
    const load = departmentLoad(d, tctx, { catalogue });
    const agents = d.agents.map((slug) => cards.find((c) => c.slug === slug)).filter(Boolean).map((a) => {
      const goal = a.doingNow ? goalOf(a.doingNow.taskId) : null;
      return {
        id: a.id, slug: a.slug, name: cut(a.name, NAME_MAX), state: a.state, plainState: a.plainState, waitingForYou: a.waitingForYou === true,
        doing: a.doingNow ? {
          title: cut(goal ? goal.title : a.doingNow.title, TITLE_MAX),
          taskId: a.doingNow.taskId || null,
          identifier: goal && typeof goal.identifier === "string" ? goal.identifier : null,
        } : null,
        lastActiveAt: a.lastActiveAt || null,
      };
    });
    return {
      id: d.id, title: d.title, line: d.line,
      counts: { working: load.working, needsYou: load.needsYou, jobs: (catalogue.byDepartment.get(d.id) || []).length },
      agents,
    };
  });
}

// The three doors as Settings sees them. `blocked`: off, and Settings would not let it be switched on.
function doorsOf(ctx, web, gen) {
  const roles = loadRoles(ctx.config, { log: ctx.log });
  const agents = (id) => DOOR_AGENTS[id].filter((slug) => roles.some((r) => r.slug === slug));
  const door = (id, on, blocked, sentence, spends) => ({ id, title: DOOR_TITLES[id], on, blocked: !on && blocked, sentence, spends, agents: agents(id) });
  return [
    web ? door("web", web.on === true, !web.canSwitchOn, web.whyNot || web.door.sentence, false)
      : door("web", false, false, WEB_DOOR_SENTENCES.off, false),
    gen ? door("generation", gen.on === true, !gen.canSwitchOn, gen.whyNot || gen.door.sentence, true)
      : door("generation", false, false, GEN_DOOR_SENTENCES.off, true),
    gen ? door("higgsfield", gen.higgsfield.on === true, !gen.higgsfield.signedIn, gen.higgsfield.sentence, true)
      : door("higgsfield", false, false, HF_SENTENCES.signedOut, true),
  ];
}

// What was spent today against the daily limit, from the Generation view's own reads (its `spent` and `caps`).
function moneyOf(gen) {
  if (!gen || !gen.spent || gen.spent.ok !== true) {
    return {
      ok: false,
      today: { spent: null, limit: gen ? gen.caps.daily : 0 },
      month: { spent: null, limit: gen ? gen.caps.monthly : 0 },
      line: LEDGER_SENTENCES.unreadable,
    };
  }
  return {
    ok: true,
    today: { spent: gen.spent.day, limit: gen.caps.daily },
    month: { spent: gen.spent.month, limit: gen.caps.monthly },
    line: `${dollars(gen.spent.day)} of ${dollars(gen.caps.daily)} spent today.`,
  };
}

export default function register(app) {
  app.get("/api/world", async (ctx) => {
    const [{ tctx, boardOff }, web, gen, apps] = await Promise.all([
      taskModel(ctx),
      orElse(() => webSwitchOf(ctx), null, ctx, "the web switch"),
      orElse(() => buildGenerationView(ctx), null, ctx, "the generation view"),
      orElse(() => buildAppsView(ctx), null, ctx, "App Studio"),
    ]);
    return {
      company: { name: cut(await companyName(ctx, tctx), NAME_MAX) },
      boardOff,
      rooms: await orElse(() => roomsOf(ctx, tctx), [], ctx, "the departments"),
      doors: doorsOf(ctx, web, gen),
      studio: apps ? { state: apps.host.state, sentence: apps.host.sentence } : { state: "off", sentence: HOST_SENTENCES.off },
      apps: apps ? apps.apps.map((a) => ({
        slug: a.slug, name: a.name, state: a.state, on: a.on === true, sentence: a.sentence,
        spending: { open: a.spending.open === true, words: a.spending.words },
      })) : [],
      money: moneyOf(gen),
      generatedAt: new Date().toISOString(),
    };
  });
}
