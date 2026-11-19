// The Windows remote door (PLAN-DESKTOP DW2, PLAN-STRESS T12): this Mac's own sshd, run by parts/41-remote.sh. It has
// no HTTP routes of its own (a PC reaches the home's seat ports through its forward; the route sweep's seats pass
// covers those). What is checked here, on the staged copy, without ever starting sshd (it would listen beyond this
// Mac): the door is off by default (no `remote/on` marker, nothing on its port); `door.mjs port` names the staged
// port, not a live one; `door.mjs prepare` refuses with its plain reason when no PC is allowed, and when a seat is
// allowed but its key is missing; and nothing it wrote is readable by others.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { writeSeats } from "../routes/desk.mjs";
import { notCovered } from "./util.mjs";

const N = process.execPath;

function door(stage, arg) {
  const r = spawnSync(N, ["--import", join(stage.engineDir, "stress", "lib", "netguard.mjs"), join(stage.engineDir, "remote", "door.mjs"), arg], {
    cwd: stage.engineDir, encoding: "utf8", timeout: 30000,
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: join(stage.root, "home"), TMPDIR: join(stage.root, "tmp"), STRESS_PART: "remote", STRESS_STAGE_ROOT: stage.root },
  });
  return { code: r.status, out: String(r.stdout || "").trim(), err: String(r.stderr || "").trim() };
}

const listening = (port) => new Promise((resolve) => {
  const s = net.connect({ host: "127.0.0.1", port }, () => { s.destroy(); resolve(true); });
  s.on("error", () => resolve(false));
  s.setTimeout(2000, () => { s.destroy(); resolve(false); });
});

function openToOthers(dir) {
  const bad = [];
  const walk = (d) => {
    let names = [];
    try { names = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const p = join(d, e.name);
      try { if ((statSync(p).mode & 0o077) !== 0) bad.push(p); } catch { /* gone */ }
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return bad;
}

export async function remoteSweep(ctx, stage) {
  const ev = {};
  const files = ["engine/remote/door.mjs", "engine/parts/41-remote.sh"];
  const rec = (severity, check, title, expected, actual) => ctx.record({ severity, area: "remote", check, target: "remote door", title, expected, actual: String(actual).slice(0, 1000), suspectFiles: files });
  const dir = join(stage.state, "remote");
  ev.markerAtStart = existsSync(join(dir, "on"));
  ev.portOpenAtStart = await listening(stage.ports.remote);
  ctx.check(2);
  if (ev.markerAtStart) rec("high", "off-by-default", "The remote door's on marker is there on a fresh engine", "no remote/on marker until the owner runs engine remote on", join(dir, "on"));
  if (ev.portOpenAtStart) rec("high", "off-port", "Something listens on the remote door's port on a fresh engine", "nothing listens", stage.ports.remote);

  const p = door(stage, "port");
  ev.port = p;
  ctx.check();
  if (p.code !== 0 || Number(p.out) !== stage.ports.remote) rec("medium", "port", "door.mjs port did not name the staged door port", String(stage.ports.remote), JSON.stringify(p));

  const none = door(stage, "prepare");
  ev.prepareNoSeats = none;
  ctx.check();
  if (none.code !== 1 || !/^The remote door could not start: no PC is allowed yet\.$/.test(none.out)) rec("high", "prepare-none", "The remote door did not refuse to start with no PC allowed", "exit 1, The remote door could not start: no PC is allowed yet.", JSON.stringify(none));

  // A seat allowed in seats.json but with no key beside it: refused as unreadable, never started.
  writeSeats(stage.state);
  const nokey = door(stage, "prepare");
  ev.prepareNoKey = nokey;
  ctx.check();
  if (nokey.code !== 1 || !/^The remote door could not start: /.test(nokey.out)) rec("high", "prepare-nokey", "The remote door did not refuse a seat with no key", "exit 1 and a plain reason", JSON.stringify(nokey));

  ev.stillClosed = !(await listening(stage.ports.remote));
  ev.markerAfter = existsSync(join(dir, "on"));
  ev.openToOthers = [...openToOthers(dir), ...openToOthers(join(stage.state, "secrets", "remote"))];
  ctx.check(3);
  if (!ev.stillClosed || ev.markerAfter) rec("high", "stays-off", "The remote door opened or marked itself on after prepare", "still off", JSON.stringify(ev));
  if (ev.openToOthers.length) rec("medium", "modes", "The remote door left a file others can read", "mode 600 files in 700 folders", ev.openToOthers.join(", "));
  notCovered(ctx, "doors: the remote door's sshd is never started in the stage (it would listen beyond this Mac); its prepare, port and off state are checked, and engine/remote/test covers the rest");
  return ev;
}
