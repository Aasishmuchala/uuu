// Static files (PLAN-STRESS T4; engine/home/server/lib/static.mjs): path escapes (encoded and raw dots, a link to the
// canary planted in the stage's copy of `public`, a linked folder), every file under `public` answers 200 with the
// headers the index gets, and a HEAD and a range call behave.
import { readdirSync, rmSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { pool, short } from "./common.mjs";

const FILES = ["engine/home/server/lib/static.mjs", "engine/home/server/lib/app.mjs"];
const BASE_HEADERS = ["cache-control", "x-content-type-options", "x-frame-options", "referrer-policy"];

function walk(dir, root = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, root, out);
    else if (e.isFile()) out.push(relative(root, full));
  }
  return out;
}

export async function staticSweep(env) {
  const { st, hit, port } = env;
  const pub = join(st.engineDir, "home", "public");
  const files = walk(pub);
  const enc = (rel) => `/${rel.split("/").map(encodeURIComponent).join("/")}`;

  // The index's headers are the bar for every other file.
  const index = await hit(port, "GET", "/", { owner: false });
  env.check();
  const missing = (res, html) => [...BASE_HEADERS, ...(html ? ["content-security-policy"] : [])].filter((h) => !res.headers || res.headers[h] === undefined);
  if (index.status !== 200 || missing(index, true).length) {
    env.issue("high", "static-index", "static /", { title: `the index answered ${index.status} or without its security headers`, expected: `200 with ${[...BASE_HEADERS, "content-security-policy"].join(", ")}`, actual: `${index.status} missing ${missing(index, true).join(", ")}`, files: FILES });
  }
  const wrong = [];
  await pool(10, files, async (rel) => {
    const res = await hit(port, "GET", enc(rel), { owner: false, route: "static files" });
    env.check();
    const html = /\.html?$/.test(rel);
    if (res.status !== 200) wrong.push(`${rel}: ${short(res).slice(0, 80)}`);
    else if (missing(res, html).length) wrong.push(`${rel}: no ${missing(res, html).join(", ")}`);
    else if (html && res.headers["content-security-policy"] !== index.headers["content-security-policy"]) wrong.push(`${rel}: another content policy`);
  });
  if (wrong.length) env.issue("medium", "static-file", "static public", { title: `${wrong.length} of ${files.length} public files did not answer 200 with the index's headers`, expected: "200 and the security headers", actual: wrong.slice(0, 10).join(" | "), files: FILES });

  // Escapes: encoded and raw dots, NUL, backslashes, a planted link to the canary, a planted linked folder.
  const link = join(pub, "stress-link.txt");
  const dirLink = join(pub, "stress-dir");
  try { symlinkSync(env.canaryPath, link); } catch { /* there already */ }
  try { symlinkSync(st.root, dirLink); } catch { /* there already */ }
  const escapes = [
    "/..%2f..%2fconfig.json", "/%2e%2e/%2e%2e/config.json", "/%2e%2e%2f%2e%2e%2fconfig.json", "/../../config.json",
    "/assets/..%2f..%2f..%2f..%2fconfig.json", "/..%5c..%5cconfig.json", "/%00index.html", "/index.html%00.png",
    `/..%2f..%2f..%2f..%2f${env.canaryName}`, "/stress-link.txt", `/stress-dir/${env.canaryName}`, "/stress-dir/state/secrets/provider/omega-key",
    "/.git/config", "/%2egit/config",
  ];
  for (const p of escapes) {
    const res = await hit(port, "GET", p, { owner: false });
    env.check();
    if (res.status >= 500 || res.hang) env.issue("high", "static-escape-5xx", `static ${p}`, { title: `the static path ${p} answered ${short(res).slice(0, 60)}`, expected: "404", actual: short(res), files: FILES });
    else if (res.canary || res.text.includes("sk-stress-fake") || /"stateRoot"/.test(res.text)) {
      env.issue("critical", "static-escape", `static ${p}`, { title: `the static path ${p} served a file outside public`, expected: "404", actual: short(res).slice(0, 200), files: FILES });
    } else if (res.status === 200 && res.text !== index.text) {
      env.issue("medium", "static-escape-200", `static ${p}`, { title: `the static path ${p} answered 200`, expected: "404", actual: short(res).slice(0, 200), files: FILES });
    }
  }
  rmSync(link, { force: true });
  rmSync(dirLink, { force: true });

  // HEAD and range on a file of a fair size.
  const big = files.filter((f) => /\.(js|css)$/.test(f))[0] || "index.html";
  const full = await hit(port, "GET", enc(big), { owner: false });
  const head = await hit(port, "HEAD", enc(big), { owner: false });
  env.check(2);
  if (head.status !== 200 || head.text !== "" || String(head.headers["content-length"]) !== String(full.headers["content-length"])) {
    env.issue("medium", "static-head", `static HEAD ${big}`, { title: `HEAD ${big} did not answer like its GET without a body`, expected: `200, no body, content-length ${full.headers["content-length"]}`, actual: `${head.status} body ${head.text.length} bytes, content-length ${head.headers["content-length"]}`, files: FILES });
  }
  for (const range of ["bytes=0-9", "bytes=5-", "bytes=999999999-", "bytes=9-0", "bytes=0-1,4-5", "items=0-9", "bytes=-5"]) {
    const res = await hit(port, "GET", enc(big), { owner: false, headers: { range } });
    env.check();
    if (res.status >= 500 || res.hang || res.error) {
      env.issue("high", "static-range", `static range ${range}`, { title: `GET ${big} with Range ${range}: ${short(res).slice(0, 60)}`, expected: "206, 200 or 416", actual: short(res), files: FILES });
    } else if (res.status === 206 && range === "bytes=0-9" && res.text.length !== 10) {
      env.issue("medium", "static-range", `static range ${range}`, { title: `GET ${big} with Range ${range} answered 206 with ${res.text.length} bytes`, expected: "10 bytes", actual: res.headers["content-range"] || "", files: FILES });
    } else if (![200, 206, 416].includes(res.status)) {
      env.issue("medium", "static-range", `static range ${range}`, { title: `GET ${big} with Range ${range} answered ${res.status}`, expected: "206, 200 or 416", actual: short(res), files: FILES });
    }
  }
  return { files: files.length };
}
