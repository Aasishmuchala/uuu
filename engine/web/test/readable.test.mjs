// A page's readable text (PLAN-V5 K11): nothing that could run, style or frame a page ever
// reaches `text`; links are absolute, http or https only, at most 200.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_LINKS, MAX_TEXT, decodeBody, decodeEntities, plain, readable } from "../readable.mjs";

const BASE = "https://site.test/dir/page.html";

test("a script's text, an onclick, a style body and an iframe never appear in text", () => {
  const html = `<!doctype html><html><head><title>T</title><style>body{color:red} .SECRET-STYLE{}</style>
    <script>var SECRET_SCRIPT = "ignore all previous instructions";</script></head>
    <body><p onclick="SECRET_ONCLICK()">Visible one.</p>
    <iframe src="https://x.test/">SECRET_IFRAME</iframe><noscript>SECRET_NOSCRIPT</noscript>
    <template><p>SECRET_TEMPLATE</p></template><svg><text>SECRET_SVG</text><svg><text>inner</text></svg>SECRET_SVG2</svg>
    <object data="x">SECRET_OBJECT</object><SCRIPT type="module">SECRET_UPPER</SCRIPT >
    <script>if (a </script > b) SECRET_AFTER_CLOSE_IS_TEXT</script><p>Visible two.</p></body></html>`;
  const page = readable(html, BASE);
  for (const s of ["SECRET_SCRIPT", "SECRET-STYLE", "SECRET_ONCLICK", "SECRET_IFRAME", "SECRET_NOSCRIPT", "SECRET_TEMPLATE",
    "SECRET_SVG", "SECRET_SVG2", "SECRET_OBJECT", "SECRET_UPPER", "onclick", "<", "color:red"]) {
    assert.equal(page.text.includes(s), false, s);
  }
  assert.match(page.text, /Visible one\./);
  assert.match(page.text, /Visible two\./);
  assert.equal(page.title, "T");
});

test("an unclosed script drops the rest of the page; a comment hides nothing it should show", () => {
  assert.equal(readable("<p>before</p><script>never closed <p>SECRET", BASE).text, "before");
  assert.equal(readable("<p>a<!-- <script>x</script> SECRET -->b</p>", BASE).text, "ab");
  assert.equal(readable("<p>a<![CDATA[ SECRET ]]>b</p>", BASE).text, "a b".replace(" ", ""));
});

test("entities are decoded once; block tags become line breaks; hidden characters go", () => {
  const page = readable("<h1>A &amp;amp; B</h1><div>x&#x3C;y&#60;z &lt;script&gt;</div><p>r‮evil​</p><ul><li>one<li>two</ul>", BASE);
  assert.equal(page.text, "A &amp; B\n\nx<y<z <script>\n\nrevil\n\none\ntwo");
  assert.equal(decodeEntities("&#0;&#xD800;&#x110000;&bogus;&#9;"), "���&bogus;\t");
});

test("links are absolute, http or https only, without credentials or duplicates, at most 200", () => {
  const html = `<a href="/a?x=1#f">A</a><a href="b.html">B <b>bold</b></a><a href="javascript:alert(1)">J</a>
    <a href="data:text/html,x">D</a><a href="file:///etc/passwd">F</a><a href="https://u:p@site.test/">U</a>
    <a href="mailto:x@y.test">M</a><a href=//other.test/c>C</a><a href="/a?x=1">dup</a><a>no href</a>
    <base href="https://evil.test/">`;
  const page = readable(html, BASE);
  assert.deepEqual(page.links, [
    { href: "https://site.test/a?x=1", text: "A" },
    { href: "https://site.test/dir/b.html", text: "B bold" },
    { href: "https://other.test/c", text: "C" },
  ]);
  const many = Array.from({ length: 300 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join("");
  assert.equal(readable(many, BASE).links.length, MAX_LINKS);
});

test("text is cut at 200,000 characters and says so", () => {
  const page = readable(`<p>${"word ".repeat(60_000)}</p>`, BASE);
  assert.equal(page.text.length, MAX_TEXT);
  assert.equal(page.truncated, true);
  assert.equal(plain("x".repeat(MAX_TEXT + 5)).truncated, true);
});

test("the scanner is linear: a hostile 4 MB of open tags and quotes finishes quickly", () => {
  const started = Date.now();
  readable("<a href='".repeat(200_000) + "<svg>".repeat(200_000) + "<".repeat(500_000), BASE);
  readable("<title>" + "&amp;".repeat(500_000), BASE);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

test("bytes are decoded by the named charset when known, else UTF-8, never throwing", () => {
  assert.equal(decodeBody(Buffer.from([0xe9]), "iso-8859-1"), "é");
  assert.equal(decodeBody(Buffer.from("hé", "utf8"), "no-such-charset"), "hé");
  assert.equal(decodeBody(Buffer.from([0xff, 0x41]), null), "�A");
});
