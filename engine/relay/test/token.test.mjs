// The relay token (C3) and the upstream origin rule (C1).
import test from "node:test";
import assert from "node:assert/strict";
import { mintToken, checkToken } from "../token.mjs";
import { PROVIDER_ORIGIN, PROVIDER_NAME, checkOrigin } from "../upstream.mjs";

const SECRET = "a".repeat(64);
const AGENT = "11111111-2222-4333-8444-555555555555";
const GOLDEN_A = "v1.a.11111111-2222-4333-8444-555555555555.1800000000.f9e21b44fbf14fa08d3eb8407a21a75d9731bbd485b3988694859b691e777c91";
const GOLDEN_T = "v1.t.checker.1800000000.5f754436db7e15338f63a36b71aafd8c170fa61a9ef88140e05eebcc380e4597";
const BEFORE = 1800000000 - 3600; // one hour before the vectors end, in seconds

test("the C3 golden vectors are minted exactly", () => {
  assert.equal(mintToken(SECRET, "a", AGENT, 1800000000), GOLDEN_A);
  assert.equal(mintToken(SECRET, "t", "checker", 1800000000), GOLDEN_T);
});

test("checkToken accepts the golden vectors, with now in seconds or in milliseconds", () => {
  assert.deepEqual(checkToken(SECRET, GOLDEN_A, BEFORE), { kind: "a", subject: AGENT, exp: 1800000000 });
  assert.deepEqual(checkToken(SECRET, GOLDEN_T, BEFORE * 1000), { kind: "t", subject: "checker", exp: 1800000000 });
});

test("checkToken refuses a wrong mac, another secret, an expired token and one too far ahead", () => {
  const flipped = GOLDEN_A.slice(0, -1) + (GOLDEN_A.endsWith("1") ? "2" : "1");
  assert.equal(checkToken(SECRET, flipped, BEFORE), null);
  assert.equal(checkToken("b".repeat(64), GOLDEN_A, BEFORE), null);
  assert.equal(checkToken(SECRET, GOLDEN_A, 1800000000), null, "exp must be after now");
  assert.equal(checkToken(SECRET, GOLDEN_A, 1800000000 + 5), null);
  assert.notEqual(checkToken(SECRET, GOLDEN_A, 1800000000 - 7 * 3600), null, "exactly seven hours ahead is accepted");
  assert.equal(checkToken(SECRET, GOLDEN_A, 1800000000 - 7 * 3600 - 1), null, "more than seven hours ahead is refused");
});

test("checkToken refuses every token whose shape is not exact", () => {
  const swapped = GOLDEN_A.replace(AGENT, "99999999-2222-4333-8444-555555555555");
  const bad = [
    swapped,                                   // another agent's id under this mac
    GOLDEN_A.replace("v1.", "v2."),
    GOLDEN_A.replace(".a.", ".x."),
    GOLDEN_A.replace(".a.", ".t."),            // kind changed: mac no longer matches
    GOLDEN_A.toUpperCase(),
    `${GOLDEN_A}.`,
    ` ${GOLDEN_A}`,
    GOLDEN_A.replace(".1800000000.", ".01800000000."),
    mintToken(SECRET, "t", "checker", 1800000000).replace("checker", "Checker"),
    `v1.a.not-a-uuid.1800000000.${"0".repeat(64)}`,
    "", null, undefined, 42, "v1.a",
  ];
  for (const t of bad) assert.equal(checkToken(SECRET, t, BEFORE), null, String(t));
});

test("a missing or malformed secret refuses every token, and mintToken will not use one", () => {
  for (const s of [null, "", "a".repeat(63), "A".repeat(64), `${"a".repeat(64)}\n`, "g".repeat(64)]) {
    assert.equal(checkToken(s, GOLDEN_A, BEFORE), null);
    assert.throws(() => mintToken(s, "a", AGENT, 1800000000));
  }
  assert.throws(() => mintToken(SECRET, "a", "builder", 1800000000), /subject/);
  assert.throws(() => mintToken(SECRET, "t", "Bad Slug", 1800000000), /subject/);
  assert.throws(() => mintToken(SECRET, "a", AGENT, 1.5), /exp/);
});

test("the upstream is exactly the provider's origin or a 127.0.0.1 stand-in", () => {
  assert.equal(PROVIDER_ORIGIN, "https://api.omegaplusapi.com");
  assert.equal(PROVIDER_NAME, "Omega Plus");
  assert.deepEqual(checkOrigin(PROVIDER_ORIGIN), { origin: PROVIDER_ORIGIN, protocol: "https:", hostname: "api.omegaplusapi.com", port: 443 });
  assert.equal(checkOrigin("http://127.0.0.1:4567").port, 4567);
  for (const o of [undefined, null, "", `${PROVIDER_ORIGIN}/`, "http://api.omegaplusapi.com", "https://api.omegaplusapi.com:443",
    "https://API.omegaplusapi.com", "https://api.omegaplusapi.com.evil.test", "https://evil.test", "http://localhost:4567",
    "http://127.0.0.1", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1:80/v1", "https://127.0.0.1:4567",
    "http://user@127.0.0.1:4567", "http://127.0.0.2:4567"]) {
    assert.throws(() => checkOrigin(o), /upstream must be/, String(o));
  }
});
