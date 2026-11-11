// CONTRACTS-V2 17.7 (V30): the owner's appearance settings and the list of things that may come later.
const ACCENTS = [
  { id: "graphite", label: "Graphite" }, { id: "blue", label: "Blue" }, { id: "green", label: "Green" },
  { id: "violet", label: "Violet" }, { id: "orange", label: "Orange" }, { id: "rose", label: "Rose" },
];
const THEMES = ["auto", "light", "dark"];
const KEY = "settings:appearance";

// Nothing here can be switched on: there is no route that changes a `later` entry.
const LATER = [
  { id: "local_model", label: "A free helper model on this Mac", on: false,
    explain: "Small jobs could run on this Mac instead of your plans.",
    cost: "About 5 GB of disk and 4 GB of memory while it runs.",
    how: "Not built yet. Ask for it when you have the disk to spare.",
    technical: "Ollama, already installed on this Mac." },
  { id: "chat_apps", label: "Other chat apps as extra windows", on: false,
    explain: "Other chat apps could talk to your company as extra windows.",
    cost: "Nothing to install beyond the chat app itself.",
    how: "Not built yet. Ask for it when you want another window.",
    technical: "An OpenAI-compatible address for LobeHub, Open WebUI, Cherry Studio or Jan." },
  { id: "workflow_engine", label: "A separate workflow engine", on: false,
    explain: "A dedicated engine could run long, scheduled workflows.",
    cost: "About 4 GB of memory while it runs.",
    how: "Not built yet. Ask for it when routines are not enough.",
    technical: "Kestra." },
  { id: "pixel_editor", label: "Edit sprites in place", on: false,
    explain: "You could touch up a sprite right here instead of asking again.",
    cost: "A small download, served from this Mac.",
    how: "Not built yet. Ask for it when you want to edit sprites by hand.",
    technical: "Piskel, Apache-2.0, served by the home server." },
  { id: "aseprite_files", label: "Preview Aseprite files", on: false,
    explain: "Sprite files from Aseprite could be shown on the Studio page.",
    cost: "Needs your own copy of Aseprite to make the files.",
    how: "Not built yet. Ask for it when you have Aseprite.",
    technical: "A small MIT parser; needs the owner's own copy of Aseprite." },
];

function appearanceOf(ctx) {
  const saved = ctx.decisions.get(KEY);
  const theme = saved && THEMES.includes(saved.theme) ? saved.theme : "auto";
  const accent = saved && ACCENTS.some((a) => a.id === saved.accent) ? saved.accent : "graphite";
  return { theme, accent };
}

export default function register(app) {
  app.get("/api/settings", async (ctx) => ({
    appearance: appearanceOf(ctx),
    accents: ACCENTS.map((a) => ({ ...a })),
    later: LATER.map((l) => ({ ...l })),
  }));

  app.post("/api/settings", async (ctx) => {
    const body = ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {};
    const next = appearanceOf(ctx);
    if (Object.hasOwn(body, "theme")) {
      if (typeof body.theme !== "string" || !THEMES.includes(body.theme)) throw ctx.fail(400, "That theme is not one of the choices.", "Pick auto, light or dark.", "bad_setting");
      next.theme = body.theme;
    }
    if (Object.hasOwn(body, "accent")) {
      if (typeof body.accent !== "string" || !ACCENTS.some((a) => a.id === body.accent)) throw ctx.fail(400, "That colour is not one of the choices.", "Pick one of the colours shown.", "bad_setting");
      next.accent = body.accent;
    }
    ctx.decisions.set(KEY, next);
    return { ok: true, appearance: next };
  });
}
