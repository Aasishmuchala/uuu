// The trust rule (C2) and the readers of the model files.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trusted, readModelState, readIds, readSecret, readKey } from "../state.mjs";

let dir;
let n = 0;
function file(text, mode = 0o600) {
  n += 1;
  const p = join(dir, `f${n}`);
  writeFileSync(p, text);
  chmodSync(p, mode);
  return p;
}
const missing = () => join(dir, `missing${(n += 1)}`);
const STATE = { version: 1, mode: "provider", picks: { builder: { model: "claude-fable-5-1", source: "ranked" } } };

before(() => { dir = mkdtempSync(join(tmpdir(), "relay-state-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

test("trusted: a 0600 or 0644 regular file of this user under 1 MB, and nothing else", () => {
  assert.equal(trusted(file("x")), true);
  assert.equal(trusted(file("x", 0o644)), true);
  assert.equal(trusted(file("x", 0o620)), false, "group-writable");
  assert.equal(trusted(file("x", 0o602)), false, "writable by others");
  assert.equal(trusted(file("x".repeat(1024 * 1024 + 1))), false, "over 1 MB");
  assert.equal(trusted(file("x".repeat(1024 * 1024))), true, "exactly 1 MB");
  const link = join(dir, "link");
  symlinkSync(file("x"), link);
  assert.equal(trusted(link), false, "a link");
  const sub = join(dir, "sub");
  mkdirSync(sub);
  assert.equal(trusted(sub), false, "a folder");
  const fifo = join(dir, "fifo");
  execFileSync("/usr/bin/mkfifo", [fifo]);
  assert.equal(trusted(fifo), false, "a pipe");
  assert.equal(trusted(missing()), false);
});

test("readModelState: no file is plans mode; untrusted, not JSON or another mode is a problem", () => {
  const none = readModelState(missing());
  assert.equal(none.ok, true);
  assert.equal(none.missing, true);
  assert.equal(none.mode, "plans");
  assert.deepEqual({ ...none.picks }, {});
  const good = readModelState(file(JSON.stringify(STATE)));
  assert.equal(good.ok, true);
  assert.equal(good.mode, "provider");
  assert.equal(good.picks.builder, "claude-fable-5-1");
  assert.deepEqual(readModelState(file(JSON.stringify(STATE), 0o660)), { ok: false, problem: "untrusted" });
  assert.deepEqual(readModelState(file("{not json")), { ok: false, problem: "not_json" });
  assert.deepEqual(readModelState(file("[]")), { ok: false, problem: "not_json" });
  assert.deepEqual(readModelState(file('{"mode":"on"}')), { ok: false, problem: "bad_mode" });
  assert.deepEqual(readModelState(file("{}")), { ok: false, problem: "bad_mode" });
  const link = join(dir, "state-link");
  symlinkSync(file(JSON.stringify(STATE)), link);
  assert.deepEqual(readModelState(link), { ok: false, problem: "untrusted" });
  const fifo = join(dir, "state-fifo");
  execFileSync("/usr/bin/mkfifo", [fifo]);
  assert.deepEqual(readModelState(fifo), { ok: false, problem: "untrusted" }, "a pipe is refused without hanging");
});

test("readModelState keeps only picks whose slug and model fit the patterns", () => {
  const text = JSON.stringify({ mode: "provider", picks: {
    builder: { model: "claude-fable-5-1" }, sales: { model: "Claude Fable" }, support: { model: "x".repeat(81) },
    people: "claude-opus-5-5", "Bad Slug": { model: "claude-opus-5-5" },
    checker: { model: "claude-gpt-6-1-sol", source: "owner" },
  } }).replace('"picks":{', '"picks":{"__proto__":{"model":"claude-opus-5-5"},');
  const st = readModelState(file(text));
  assert.deepEqual({ ...st.picks }, { builder: "claude-fable-5-1", checker: "claude-gpt-6-1-sol" });
  assert.equal(st.picks.toString, undefined, "no inherited names");
});

test("readIds, readSecret and readKey refuse what is missing, untrusted or malformed", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  assert.deepEqual({ ...readIds(file(JSON.stringify({ agents: { builder: id, bad: "NOT-AN-ID", Upper: id } }))) }, { builder: id });
  assert.equal(readIds(file(JSON.stringify({ agents: { builder: id } }), 0o666)), null);
  assert.equal(readIds(file("[]")), null);
  assert.equal(readIds(missing()), null);

  const secret = "0123456789abcdef".repeat(4);
  assert.equal(readSecret(file(`${secret}\n`)), secret);
  assert.equal(readSecret(file(secret)), secret);
  assert.equal(readSecret(file(`${secret}\n`, 0o622)), null);
  assert.equal(readSecret(file(`${secret.toUpperCase()}\n`)), null);
  assert.equal(readSecret(file(`${secret}\n\n`)), null);
  assert.equal(readSecret(file(secret.slice(1))), null);
  assert.equal(readSecret(missing()), null);

  const key = "sk-made-up-key-0000000000";
  assert.equal(readKey(file(`${key}\n`)), key);
  assert.equal(readKey(file(`${key}\n`, 0o660)), null);
  assert.equal(readKey(file("short\n")), null);
  assert.equal(readKey(file(`${key}\nsecond line\n`)), null);
  assert.equal(readKey(file("")), null);
  assert.equal(readKey(missing()), null);
});
