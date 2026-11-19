// The walls that need no stage: the bases, the live state, the live ports in the HTTP client.
import assert from "node:assert/strict";
import net from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { call } from "../lib/http.mjs";
import { checkStateFolder, startStage } from "../lib/stage.mjs";

describe("the walls without a stage", () => {
  test("base 3200 is refused, and so is any base not in the six", async () => {
    await assert.rejects(startStage({ base: 3200 }), { message: "stage: base 3200 is not allowed" });
    await assert.rejects(startStage({ base: 4350 }), { message: "stage: base 4350 is not allowed" });
  });

  test("a stage folder inside the live state is refused", () => {
    assert.throws(() => checkStateFolder(join(homedir(), ".paperclip", "uuu-engine", "x")), { message: "stage: the state folder is inside the live state; refused" });
    assert.throws(() => checkStateFolder(join(homedir(), ".paperclip")), { message: "stage: the state folder is inside the live state; refused" });
  });

  test("http.call to 127.0.0.1:3200 throws without sending a byte", () => {
    const real = net.Socket.prototype.connect;
    let opened = 0;
    net.Socket.prototype.connect = function counted(...a) { opened += 1; return real.apply(this, a); };
    try {
      assert.throws(() => call("http://127.0.0.1:3200/healthz"), /port 3200 is a live port; not sent/);
      assert.throws(() => call("http://127.0.0.1:8120/"), /port 8120 is a live port; not sent/);
      assert.throws(() => call("http://127.0.0.1:5432/"), /port 5432 is a live port; not sent/);
      assert.throws(() => call("http://example.com:4399/"), /example\.com is not this Mac; not sent/);
      assert.throws(() => call("https://127.0.0.1:4399/"), /https: is not allowed/);
    } finally {
      net.Socket.prototype.connect = real;
    }
    assert.equal(opened, 0);
  });
});
