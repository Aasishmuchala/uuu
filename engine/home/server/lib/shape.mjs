// Shape checking for tests (CONTRACTS-V2 16.5): an example file against an actual value.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHAPES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "shapes");

export function readShape(name) {
  if (!/^[a-z-]+$/.test(name)) throw new Error(`bad shape name: ${name}`);
  return JSON.parse(fs.readFileSync(path.join(SHAPES, `${name}.json`), "utf8"));
}

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

// Problems found, as "path: what"; an empty list means the value fits the example.
export function sameShape(example, actual) {
  const problems = [];
  const walk = (ex, ac, at) => {
    if (ex === null || ac === null) return;
    const te = typeOf(ex), ta = typeOf(ac);
    if (ac === undefined) { problems.push(`${at || "(root)"}: missing`); return; }
    if (te !== ta) { problems.push(`${at || "(root)"}: expected ${te}, got ${ta}`); return; }
    if (te === "array") {
      if (!ex.length) return;
      ac.forEach((el, i) => walk(ex.length === 1 ? ex[0] : ex[Math.min(i, ex.length - 1)], el, `${at}[${i}]`));
    } else if (te === "object") {
      for (const k of Object.keys(ex)) {
        const p = at ? `${at}.${k}` : k;
        if (!Object.hasOwn(ac, k) || ac[k] === undefined) problems.push(`${p}: missing`);
        else walk(ex[k], ac[k], p);
      }
    }
  };
  walk(example, actual, "");
  return problems;
}
