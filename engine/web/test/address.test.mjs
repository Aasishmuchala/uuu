// The web door's address rules (PLAN-V5 K11 rows 8 to 10): pure functions, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { addressKey, checkAddress, hostAllowed, isOwnAddress, isPublic } from "../address.mjs";

const refused = (text) => checkAddress(text).ok === false;

test("row 8: the plan's vectors are refused", () => {
  for (const v of [
    "http://127.0.0.1/", "http://localhost/", "http://2130706433/", "http://0x7f.1/", "http://[::1]/",
    "http://[::ffff:127.0.0.1]/", "http://user:p@site.test/", "https://site.test:8443/",
    `https://site.test/${"a".repeat(1025 - "https://site.test/".length)}`,
    `https://site.test/?${"q".repeat(257)}`, "https://db.corp.internal/",
  ]) {
    assert.equal(refused(v), true, v);
  }
});

test("row 8: the length and query limits sit exactly at 1024 and 256", () => {
  const base = "https://site.test/";
  assert.equal(checkAddress(base + "a".repeat(1024 - base.length)).ok, true);
  assert.equal(refused(base + "a".repeat(1025 - base.length)), true);
  assert.equal(checkAddress(`${base}?${"q".repeat(256)}`).ok, true);
  assert.equal(refused(`${base}?${"q".repeat(257)}`), true);
});

test("row 8: other schemes, IPs in any spelling, bare names and local endings are refused", () => {
  for (const v of [
    "file:///etc/passwd", "ftp://site.test/", "javascript:alert(1)", "data:text/html,hi", "gopher://site.test/",
    "http://0177.0.0.1/", "http://127.1/", "http://0/", "http://[0:0:0:0:0:0:0:1]/", "http://[fe80::1]/",
    "http://10.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://intranet/", "http://printer.local/",
    "http://my.home.arpa/", "http://a.localhost/", "http://site.test./", "http://under_score.test/",
    "http://site.test:22/", "http://site.test:0/", "https://:p@site.test/", "http://user@site.test/",
    "http://1.2.3.4.test.1/",
  ]) {
    assert.equal(refused(v), true, v);
  }
  // A backslash is a slash to the parser: the host checked is the host connected to.
  assert.equal(checkAddress("http://site.test\\@evil.test/").host, "site.test");
});

test("row 8: control, space and non-ASCII characters are refused", () => {
  for (const v of ["http://site.test/a\nb", "http://site.test/a b", "http://site.test/é", "http://sıte.test/", "http://site.test/\x00", "http://site.test/\t"]) {
    assert.equal(refused(v), true, JSON.stringify(v));
  }
});

test("row 8: ordinary addresses pass, lower-cased, without the fragment, ports 80 and 443 only", () => {
  const a = checkAddress("https://Example.COM/Path?x=1#frag");
  assert.equal(a.ok, true);
  assert.equal(a.host, "example.com");
  assert.equal(a.href, "https://example.com/Path?x=1");
  assert.equal(a.port, 443);
  assert.equal(checkAddress("http://site.test:80/").port, 80);
  assert.equal(checkAddress("https://site.test:443/").port, 443);
  assert.equal(checkAddress("http://site.test:443/").ok, true);
  assert.equal(checkAddress("https://xn--bcher-kva.example/").ok, true);
});

test("row 9: block beats allow, a sub-domain of a blocked host is blocked, allow is by parent", () => {
  assert.equal(hostAllowed("a.evil.test", [], ["evil.test"]), false);
  assert.equal(hostAllowed("evil.test", ["evil.test"], ["evil.test"]), false);
  assert.equal(hostAllowed("notevil.test", [], ["evil.test"]), true);
  assert.equal(hostAllowed("docs.good.test", ["good.test"], []), true);
  assert.equal(hostAllowed("good.test.other.test", ["good.test"], []), false);
  assert.equal(hostAllowed("other.test", ["good.test"], []), false);
  assert.equal(hostAllowed("any.test", [], []), true);
  assert.equal(hostAllowed("any.test", [""], []), false, "an allow list of nothing usable allows nothing");
});

test("row 10: every IPv4 range of the table is not public; ordinary addresses are", () => {
  for (const ip of [
    "0.0.0.0", "0.1.2.3", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.255.255.254", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.255.255",
    "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
  ]) {
    assert.equal(isPublic(ip), false, ip);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.0", "172.15.255.255", "172.32.0.0", "198.20.0.0", "223.255.255.255"]) {
    assert.equal(isPublic(ip), true, ip);
  }
});

test("row 10: IPv6 ranges, and the forms that carry IPv4, judged by the IPv4 inside", () => {
  for (const ip of [
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "ff02::1", "2001:db8::1", "2001::1", "2001:0:abcd::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:c0a8:101", "64:ff9b::a00:1", "64:ff9b::127.0.0.1",
    "2002:7f00:1::1", "2002:c0a8:0101::1", "::127.0.0.1", "::7f00:1", "fe80::1%lo0", "fec0::1", "100::1", "64:ff9b:1::1",
  ]) {
    assert.equal(isPublic(ip), false, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001::200e", "::ffff:93.184.216.34", "64:ff9b::808:808", "2002:5db8:d822::1"]) {
    assert.equal(isPublic(ip), true, ip);
  }
});

test("row 10: what does not parse is not public", () => {
  for (const ip of ["", "localhost", "0x7f.1", "2130706433", "127.1", "01.2.3.4", "1.2.3.256", "1:2:3:4:5:6:7:8:9", "1::2::3", "gggg::1", null, undefined, 7]) {
    assert.equal(isPublic(ip), false, String(ip));
  }
});

test("row 10: this Mac's own addresses are found in any spelling", () => {
  const ifaces = { en0: [{ address: "203.0.113.50" }, { address: "2606:4700::50" }, { address: "fe80::1%en0" }] };
  assert.equal(isOwnAddress("203.0.113.50", ifaces), true);
  assert.equal(isOwnAddress("::ffff:203.0.113.50", ifaces), true);
  assert.equal(isOwnAddress("2606:4700:0:0:0:0:0:50", ifaces), true);
  assert.equal(isOwnAddress("93.184.216.34", ifaces), false);
  assert.equal(isOwnAddress("not an address", ifaces), true, "what does not parse is treated as ours");
  assert.equal(addressKey("::ffff:1.2.3.4"), addressKey("1.2.3.4"));
  // And by default, the real interfaces: loopback is always one.
  assert.equal(isOwnAddress("127.0.0.1"), true);
});
