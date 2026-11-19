// After a picture round (run-webkit.mjs), adds to EVID/r<round>/summary.json a `shots` list: one entry a picture
// ({ name, shot, width, theme, cspViolations, webglContexts, consoleErrors, failedRequests, brokenImages, overflow }),
// which the plan's done-when reads; and prints the pictures that have any of them, and the PNG count against
// four a shot. usage: node summarize.mjs [--round mac6]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVID = process.env.WEBKIT_EVID || "/Users/aasish/uuu/.router/evidence/mac";
const i = process.argv.indexOf("--round");
const round = i > 0 ? process.argv[i + 1] : "mac6";
const OUT = join(EVID, `r${round}`);
const file = join(OUT, "summary.json");
const s = JSON.parse(readFileSync(file, "utf8"));
const shotsFile = JSON.parse(readFileSync(resolve(HERE, "..", "..", "shots-webkit.json"), "utf8"));
s.shots = Object.entries(s.pictures || {}).map(([name, p]) => ({
  name, shot: p.shot, width: p.width, theme: p.theme, cspViolations: p.cspViolations || [], webglContexts: p.webglContexts ?? null,
  consoleErrors: p.consoleErrors || [], failedRequests: p.failedRequests || [], brokenImages: p.images?.broken ?? null, overflow: !!p.overflow,
  scrollWidth: p.scrollWidth ?? null, offenders: p.offenders || [], notes: p.notes || [], probeExit: p.probeExit,
}));
writeFileSync(file, `${JSON.stringify(s, null, 1)}\n`);
const pngs = readdirSync(OUT).filter((f) => f.endsWith("-webkit.png")).length;
const expected = shotsFile.reduce((n, x) => n + 2 * (x.widths ? x.widths.length : 2), 0);
console.log(`pngs ${pngs}; shots ${shotsFile.length}; 4 x shots ${4 * shotsFile.length}; pictures the shots ask for ${expected}`);
for (const k of ["cspViolations", "consoleErrors", "failedRequests"]) {
  const bad = s.shots.filter((x) => x[k].length);
  console.log(`${k}: ${bad.length ? bad.map((x) => `${x.name} ${JSON.stringify(x[k].slice(0, 2))}`).join("\n  ") : "none"}`);
}
console.log(`webgl: ${s.shots.filter((x) => x.webglContexts).map((x) => x.name).join(", ") || "none"}`);
console.log(`broken images: ${s.shots.filter((x) => x.brokenImages).map((x) => `${x.name} ${x.brokenImages}`).join(", ") || "none"}`);
console.log(`wider than the window: ${s.shots.filter((x) => x.overflow).map((x) => `${x.name} ${x.scrollWidth} ${JSON.stringify(x.offenders.slice(0, 2))}`).join("\n  ") || "none"}`);
console.log(`probe failed: ${s.shots.filter((x) => x.probeExit !== 0).map((x) => x.name).join(", ") || "none"}`);
