// apply's routine step (CONTRACTS-V2 section 18). Each routine file becomes a routine on the
// board, made as the owner, assigned to the Chief of staff, paused, with one schedule trigger.
// Afterwards only its title, description, assignee and trigger are kept in line with the file:
// whether it is on or paused is the owner's switch, and no routine is ever deleted.

export const CHIEF = "chief-of-staff";

// A routine step that cannot go on; its message is one plain sentence for the owner.
export class RoutineStop extends Error {}

// The task text every run of the routine gets.
export function routineDescription(routine, agents) {
  const head = routine.agent === CHIEF ? "" : `FOR: ${agents.find((a) => a.slug === routine.agent).name}\n`;
  return `${head}${routine.ask}\n\nProduce: ${routine.produces.join(", ")} in the goal's folder inside your current working folder.\nROUTINE: ${routine.id}`;
}

const scheduleOf = (r) => (r.triggers || []).find((t) => t.kind === "schedule") || null;

// board: apply's board client. company and project: as on the board, or null when they would
// be made (check mode). known: ids.json's `routines`. chiefId: the Chief of staff's board id,
// or null when it would be made. say(verb, thing, detail): apply's line printer.
// Returns the `routines` map for ids.json: file id -> board routine id.
export async function applyRoutines({ board, company, project, agents, routines, known = {}, chiefId, check, say }) {
  const enc = encodeURIComponent;
  const onBoard = company ? await board.get(`/api/companies/${enc(company.id)}/routines`, { what: "list the routines" }) || [] : [];
  const ids = {};
  const used = new Set();
  for (const rt of routines) {
    const want = { title: rt.title, description: routineDescription(rt, agents), assigneeAgentId: chiefId };
    const trigger = { cronExpression: rt.when.cron, timezone: rt.when.timezone, label: rt.when.plain };
    const found = onBoard.find((x) => x.id === known[rt.id] && !used.has(x.id))
      || onBoard.find((x) => x.title === rt.title && !used.has(x.id)) || null;

    if (!found) {
      if (check || !chiefId || !project) { say("created", `routine ${rt.title} (paused)`); continue; }
      const made = await board.post(`/api/companies/${enc(company.id)}/routines`, {
        ...want, projectId: project.id, priority: "medium", status: "paused",
        concurrencyPolicy: "skip_if_active", catchUpPolicy: "skip_missed",
      }, { what: `create the routine ${rt.title}` });
      if (!made || !made.id) throw new RoutineStop(`The board did not say which routine it made for ${rt.title}, so nothing more was changed.`);
      ids[rt.id] = made.id;
      used.add(made.id);
      await board.post(`/api/routines/${enc(made.id)}/triggers`, { kind: "schedule", ...trigger, enabled: true },
        { what: `set the schedule of the routine ${rt.title}` });
      say("created", `routine ${rt.title} (paused)`);
      continue;
    }

    ids[rt.id] = found.id;
    used.add(found.id);
    const patch = {};
    const changed = [];
    if (found.title !== want.title) { patch.title = want.title; changed.push("title"); }
    if (found.description !== want.description) { patch.description = want.description; changed.push("ask"); }
    if (chiefId && found.assigneeAgentId !== want.assigneeAgentId) { patch.assigneeAgentId = want.assigneeAgentId; changed.push("assigned to the Chief of staff"); }
    const have = scheduleOf(found);
    const tpatch = have ? Object.fromEntries(Object.entries(trigger).filter(([k, v]) => have[k] !== v)) : null;
    if (!have || Object.keys(tpatch).length) changed.push("schedule");
    if (!changed.length) { say("unchanged", `routine ${rt.title}`); continue; }
    if (!check) {
      if (Object.keys(patch).length) await board.patch(`/api/routines/${enc(found.id)}`, patch, { what: `update the routine ${rt.title}` });
      if (!have) {
        await board.post(`/api/routines/${enc(found.id)}/triggers`, { kind: "schedule", ...trigger, enabled: true },
          { what: `set the schedule of the routine ${rt.title}` });
      } else if (Object.keys(tpatch).length) {
        await board.patch(`/api/routine-triggers/${enc(have.id)}`, tpatch, { what: `change the schedule of the routine ${rt.title}` });
      }
    }
    say("updated", `routine ${rt.title}`, changed.join(", "));
  }
  for (const x of onBoard) {
    if (!used.has(x.id)) say("left alone", `routine ${x.title}`, "no routine file");
  }
  return ids;
}
