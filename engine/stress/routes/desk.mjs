// The seats pass of the route sweep (PLAN-STRESS T12, PLAN-DESKTOP T7): the same home, reached on its seat ports
// (base+2 to base+6) the way a second PC's browser reaches it through the remote door's forward. The stage writes
// `<state>/remote/seats.json` (folder 700, file 600, the pinned shape of engine/home/server/lib/seats.mjs):
//   seat 1  desk, allowed      may read everything (but the sign-in returns) and change only what DESK_MAY lists
//   seat 2  view, allowed      reads only
//   seat 3  desk, waiting      refused everything (not allowed yet)
//   seat 4  not in the file    refused everything
// Checks, every route of the table:
//   desk   a POST or DELETE outside DESK_MAY is 403 mac_only and changes nothing; one in DESK_MAY is never 403
//          mac_only for its plain body (an inner refusal, such as a priced inbox action, is the route's own);
//          a GET is answered as the owner's is, but SEAT_HIDDEN is 403 mac_only
//   and, read apart from the engine's own lists: a route whose address names a key, a Test, a switch, a sign-in, a
//   limit, an allowance or a price is refused to the desk seat whatever DESK_MAY says (PRICED below)
//   view   every POST and DELETE is 403 mac_only; GETs answer
//   3, 4   every call is 403 seat_unknown
//   host   on a seat port, a Host that is the seat port itself (not the home's) is 421
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { changed, digest, short, sleep } from "./common.mjs";
import { keyOf } from "./checks.mjs";
import { SKIP } from "./bodies.mjs";
import { fill } from "./table.mjs";

// Addresses a desk seat must never change, read from the address alone (keys, Test, switches, sign-ins, limits,
// allowances, rates, models, the proof, a job's start, routines, lessons, Setup, the Mac's settings, the web door's
// lists and share).
const PRICED = /\/(key|test|switch|begin|forget|caps|allowance|rate|prove|thinks|pause|resume|run|lessons|lists|share|search|search-key|skip|dismiss|mode|pick|models|start|tidy|higgsfield|runway)(\/|$)|^\/api\/models\/refresh$|^\/api\/settings$/;
const FP = (c) => `SHA256:${c.repeat(43)}`;

export function writeSeats(state) {
  const dir = join(state, "remote");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const added = new Date().toISOString();
  const seats = [
    { n: 1, name: "Stress desk PC", role: "desk", state: "allowed", fingerprint: FP("A"), added },
    { n: 2, name: "Stress view PC", role: "view", state: "allowed", fingerprint: FP("B"), added },
    { n: 3, name: "Stress waiting PC", role: "desk", state: "waiting", fingerprint: null, added },
  ];
  const file = join(dir, "seats.json");
  writeFileSync(file, `${JSON.stringify({ seats }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export async function deskPass(env, routes) {
  const { hit, st, issue } = env;
  const home = st.ports.home;
  const seat = (n) => st.ports.seats + n - 1;
  const lists = await import(pathToFileURL(join(st.engineDir, "home", "server", "lib", "seats.mjs")).href);
  const desk = new Set(lists.DESK_MAY);
  const hidden = new Set(lists.SEAT_HIDDEN);
  const file = writeSeats(st.state);
  env.log(`seats: ${file} (1 desk, 2 view, 3 waiting); seat ports ${seat(1)} to ${seat(5)}`);
  const hostHome = { host: `127.0.0.1:${home}` };
  const ownerish = { "content-type": "application/json", "x-engine": "1", ...hostHome };
  const out = { calls: 0, deskRefused: 0, deskAllowed: 0, viewRefused: 0, unknownRefused: 0, hiddenRefused: 0, reads: 0, priced: [] };
  const files = ["engine/home/server/lib/seats.mjs", "engine/home/server/lib/app.mjs"];
  const code = (res) => res.json?.error?.code;
  const bodyOf = (key, r) => {
    const v = env.valid.get(key);
    return v === null || v === undefined ? (r.method === "DELETE" ? "" : "{}") : JSON.stringify(v);
  };
  const call = async (port, r, path, body) => {
    out.calls += 1;
    env.check();
    return r.method === "GET"
      ? hit(port, "GET", path, { headers: hostHome, owner: false })
      : hit(port, r.method, path, { headers: ownerish, body, raw: true, owner: false });
  };

  // Is the seat port open at all? A home that does not listen on its seats is a finding of its own.
  const probe = await hit(seat(1), "GET", "/api/setup", { headers: hostHome, owner: false });
  env.check();
  if (probe.error) {
    issue("high", "desk-listen", "seat ports", { title: "The staged home does not answer on its seat ports", expected: `an answer on 127.0.0.1:${seat(1)}`, actual: short(probe), files });
    return out;
  }

  const writes = routes.filter((r) => r.method !== "GET" && !SKIP[keyOf(r)]);
  const reads = routes.filter((r) => r.method === "GET" && !SKIP[keyOf(r)]);

  // Refusals first, with the state watched: the desk seat outside DESK_MAY, then the view seat on every write.
  const quiet = digest(st.state);
  await sleep(2000);
  const volatile = new Set(changed(quiet, digest(st.state)));
  const before = digest(st.state);
  for (const r of writes) {
    const key = keyOf(r);
    const path = env.paths.get(key) || fill(r.pattern, env.ids);
    const body = bodyOf(key, r);
    if (PRICED.test(r.pattern)) out.priced.push(key);
    if (!desk.has(key) || PRICED.test(r.pattern)) {
      const res = await call(seat(1), r, path, body);
      if (res.status === 403 && code(res) === "mac_only") out.deskRefused += 1;
      else issue(res.status >= 200 && res.status < 300 ? "critical" : "high", "desk-refused", `desk ${key}`, {
        title: `A desk seat was not refused ${key}${desk.has(key) ? " (an address that names a key, a switch, a sign-in, a limit or a price, yet in DESK_MAY)" : ""}`,
        expected: "403 mac_only, nothing changed", actual: short(res), files,
      });
    }
    const v = await call(seat(2), r, path, body);
    if (v.status === 403 && code(v) === "mac_only") out.viewRefused += 1;
    else issue(v.status >= 200 && v.status < 300 ? "critical" : "high", "view-refused", `view ${key}`, { title: `A view seat was not refused ${key}`, expected: "403 mac_only", actual: short(v), files });
    for (const n of [3, 4]) {
      const u = await call(seat(n), r, path, body);
      if (u.status === 403 && code(u) === "seat_unknown") out.unknownRefused += 1;
      else issue(u.status >= 200 && u.status < 300 ? "critical" : "high", "unknown-refused", `seat ${n} ${key}`, { title: `A seat that is ${n === 3 ? "waiting" : "not allowed"} was not refused ${key}`, expected: "403 seat_unknown", actual: short(u), files });
    }
  }
  const moved = changed(before, digest(st.state), volatile);
  env.check();
  if (moved.length) issue("critical", "desk-state", "seats refused", { title: "The state changed while the seats' changes were refused", expected: "no file changed", actual: moved.slice(0, 10).join(", "), files });

  // Reads: the desk and view seats as the owner (but the hidden ones), the unknown seats refused.
  for (const r of reads) {
    const key = keyOf(r);
    const path = env.paths.get(key) || fill(r.pattern, env.ids);
    const res = await call(seat(1), r, path);
    if (hidden.has(key)) {
      if (res.status === 403 && code(res) === "mac_only") out.hiddenRefused += 1;
      else issue("high", "desk-hidden", `desk ${key}`, { title: `A desk seat was given ${key}, a sign-in return`, expected: "403 mac_only", actual: short(res), files });
    } else if (res.status === 403 || res.status === 0 || res.status >= 500) {
      const owner = await hit(home, "GET", path, { owner: false });
      if (owner.status !== res.status) issue("medium", "desk-read", `desk ${key}`, { title: `A desk seat's read of ${key} was answered ${res.status}, the owner's ${owner.status}`, expected: "the owner's answer", actual: short(res), files });
    } else out.reads += 1;
    const u = await call(seat(4), r, path);
    if (u.status === 403 && code(u) === "seat_unknown") out.unknownRefused += 1;
    else issue("high", "unknown-read", `seat 4 ${key}`, { title: `A seat not allowed read ${key}`, expected: "403 seat_unknown", actual: short(u), files });
  }

  // The desk seat's own changes, last (they change the state on purpose): never refused as Mac-only, never 5xx.
  for (const r of writes) {
    const key = keyOf(r);
    if (!desk.has(key) || PRICED.test(r.pattern)) continue;
    const path = env.paths.get(key) || fill(r.pattern, env.ids);
    const res = await call(seat(1), r, path, bodyOf(key, r));
    if (res.status >= 500 || res.error) issue("high", "desk-own-5xx", `desk ${key}`, { title: `${key} from a desk seat answered ${res.status || "nothing"}`, expected: "never 5xx", actual: short(res), files });
    else if (res.status === 403 && code(res) === "mac_only" && key !== "POST /api/inbox/act") issue("medium", "desk-own", `desk ${key}`, { title: `A desk seat was refused ${key}, which DESK_MAY gives it`, expected: "the owner's answer", actual: short(res), files });
    else out.deskAllowed += 1;
  }

  // The Host rule on a seat port: the seat port's own Host is not the home screen.
  const wrong = await hit(seat(1), "GET", "/api/setup", { headers: { host: `127.0.0.1:${seat(1)}` }, owner: false });
  env.check();
  if (wrong.status !== 421) issue("medium", "desk-host", "seat host", { title: `A seat port took Host 127.0.0.1:${seat(1)} with ${wrong.status}`, expected: "421", actual: short(wrong), files });
  env.log(`seats: ${out.calls} calls; desk refused ${out.deskRefused}, desk's own ${out.deskAllowed}, view refused ${out.viewRefused}, unknown refused ${out.unknownRefused}, hidden ${out.hiddenRefused}, reads ${out.reads}`);
  return out;
}
