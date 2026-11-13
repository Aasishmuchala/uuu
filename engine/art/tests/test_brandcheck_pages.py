"""Tests for the page rules of engine/art/brandcheck.py (PLAN-V5 K16, T51). Run with the Artist's own Python:

    ~/.paperclip/uuu-engine/art/venv/bin/python -m unittest discover -s engine/art/tests -p 'test_brandcheck*.py'

Each test writes fixture sites into a goal of a state folder of its own (laid out as
test_brandcheck.py lays it out), with a test kit, its kit.css and its logo. A site that
keeps the rules passes; each broken rule fails on that rule, naming the file and the line.
"""
import json
import os
import shutil
import subprocess
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_brandcheck import BrandCheckBase, HAVE_PIL, codes  # noqa: E402

if HAVE_PIL:
    from test_kit import a_kit  # noqa: E402

KIT_CSS = ("/* The brand kit's tokens, written by the home server on every save. Change them in Files, Brand kit. */\n"
           ":root {\n  --brand-ink: #1A3C5E;\n  --brand-sand: #E8DCC8;\n  --brand-clay: #C8553D;\n"
           "  --brand-heading: \"Didot\", serif;\n  --brand-body: \"Avenir Next\", sans-serif;\n"
           "  --brand-radius: 0px;\n  --brand-min-size: 16px;\n}\n")
STYLE = """body { margin: 0; color: var(--brand-ink); background: var(--brand-sand); font-family: var(--brand-body); }
h1, h2 { font-family: var(--brand-heading); font-size: max(var(--brand-min-size), 2.5rem); }
.card { border: 1px solid var(--brand-clay); border-radius: var(--brand-radius); background: transparent; }
a:hover, a:focus-visible { color: var(--brand-clay); outline: 2px solid currentColor; }
.hero { background: url(pictures/tower.png) center / cover no-repeat; }
@media (min-width: 768px) { .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 1rem; } }
@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }
"""
INDEX = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sthyra</title>
<link rel="stylesheet" href="kit.css">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="top"><a href="index.html"><img src="logo.png" alt="Sthyra"></a></header>
<main class="grid">
<h1>Homes that follow the sun</h1>
<p>Every home we build starts with the light on its site at seven in the morning.</p>
<p><a href="https://example.com/studio">Our studio</a> <a href="mailto:hello@example.com">Write to us</a></p>
</main>
<script src="reveal.js"></script>
</body>
</html>
"""
REVEAL = """const seen = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) e.target.classList.add("is-in");
});
document.querySelectorAll("[data-reveal]").forEach((el) => seen.observe(el));
const re = /"quoted"\\/path/g;
"""
PAGE_DIRECTIONS = {"version": 1, "alias": {"newsletter": "post", "poster": "carousel"},
                   "kinds": {"page": [{"id": d} for d in ("editorial", "gallery", "spec-sheet")],
                             "post": [{"id": d} for d in ("fact-first", "scene")]}}


def in_index(body="", head=""):
    """The good index page with more in its head and before </main>."""
    return INDEX.replace("</head>", head + "</head>").replace("</main>", body + "</main>")


class PageBase(BrandCheckBase):
    def setUp(self):
        super().setUp()
        with open(os.path.join(self.brand, "kit.css"), "w", encoding="utf-8") as fh:
            fh.write(KIT_CSS)

    def site(self, name="launch", **files):
        """site/<name>/ with the good index.html, style.css, reveal.js, kit.css and logo.png; a keyword (dots
        and slashes as __ and _x_) replaces a file or, with None, leaves it out."""
        folder = os.path.join(self.goal, "site", name)
        os.makedirs(folder)
        want = {"index.html": INDEX, "style.css": STYLE, "reveal.js": REVEAL}
        for k, v in files.items():
            want[k.replace("_x_", "/").replace("__", ".")] = v
        if want.pop("kit.css", True) is not None:
            shutil.copy(os.path.join(self.brand, "kit.css"), folder)
        if want.pop("logo.png", True) is not None:
            shutil.copy(os.path.join(self.brand, "logo.png"), folder)
        for rel, text in want.items():
            if text is None:
                continue
            path = os.path.join(folder, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb" if isinstance(text, bytes) else "w") as fh:
                fh.write(text)
        return folder

    def logo_bytes(self):
        with open(os.path.join(self.brand, "logo.png"), "rb") as fh:
            return fh.read()

    def run_site(self, *extra, name="launch"):
        code, r = self.check(*extra)
        return code, self.piece(r, name)

    def details(self, p, code, which="hard"):
        return [e["detail"] for e in p[which] if e["code"] == code]

    def assertFails(self, p, code, *words):
        self.assertEqual(codes(p), [code], json.dumps(p["hard"]))
        found = self.details(p, code)
        for w in words:
            self.assertTrue(any(w in d for d in found), "%r not in %s" % (w, found))


class GoodSiteTest(PageBase):
    def test_a_site_of_tokens_kit_css_and_the_logo_passes(self):
        self.site()
        code, p = self.run_site()
        self.assertEqual((code, p["kind"], p["result"], p["hard"], p["soft"]), (0, "site", "pass", [], []))
        self.assertGreater(p["measured"]["words"], 10)

    def test_a_site_with_no_index_is_could_not_check(self):
        self.site(index__html=None)
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["could_not_check"]))
        self.assertIn("no index.html", p["hard"][0]["detail"])

    def test_three_page_versions_are_not_compared_by_their_shared_words(self):
        self.write_json(os.path.join(self.bin, "directions.json"), PAGE_DIRECTIONS)
        for v in "abc":
            self.site("launch-" + v)
        self.write_json(os.path.join(self.goal, "variants.json"), {"kind": "page", "name": "launch", "round": 1,
                        "variants": [{"id": "a", "direction": "editorial"}, {"id": "b", "direction": "gallery"},
                                     {"id": "c", "direction": "spec-sheet"}]})
        code, r = self.check()
        self.assertEqual((code, r["variants"]["present"], r["variants"]["result"]), (0, True, "pass"))
        self.assertEqual([p["result"] for p in r["pieces"]], ["pass", "pass", "pass"])


class TokensFileTest(PageBase):
    def test_one_changed_byte_in_kit_css_is_tokens_file_changed(self):
        folder = self.site()
        with open(os.path.join(folder, "kit.css"), "r+b") as fh:
            fh.seek(60)
            fh.write(b"X")
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertFails(p, "tokens_file_changed", "byte for byte")

    def test_no_kit_css_at_the_top_is_tokens_file_changed(self):
        self.site(kit__css=None, css_x_kit__css=KIT_CSS)
        code, p = self.run_site()
        self.assertFails(p, "tokens_file_changed", "no kit.css at the site's top")


class ColourTest(PageBase):
    def test_a_hex_colour_in_a_css_file_fails_with_file_and_line(self):
        self.site(style__css=STYLE + "\n.loud {\n  color: #ff00aa;\n}\n")
        code, p = self.run_site()
        self.assertEqual(code, 1)
        line = STYLE.count("\n") + 3
        self.assertFails(p, "colour_not_token", "style.css, line %d: #FF00AA is not one of the brand kit's colours"
                         % line)
        self.assertEqual(p["hard"][0]["where"], "launch")

    def test_the_same_colour_in_a_style_attribute_fails(self):
        self.site(index__html=in_index('<p style="color: #ff00aa">Loud</p>\n'))
        code, p = self.run_site()
        self.assertFails(p, "colour_not_token", "index.html, line 15, in a style attribute: #FF00AA")

    def test_the_same_colour_in_a_style_block_fails(self):
        self.site(index__html=in_index(head="<style>\n.a { color: var(--brand-ink); }\n.b { color: #ff00aa; }\n"
                                            "</style>\n"))
        code, p = self.run_site()
        self.assertFails(p, "colour_not_token", "index.html, line 10, in a <style> block: #FF00AA")

    def test_rgb_with_a_slash_alpha_fails(self):
        self.site(style__css=STYLE + ".a { background: rgb(255 0 170 / 50%); }\n")
        code, p = self.run_site()
        self.assertFails(p, "colour_not_token", "line 8: #FF00AA")

    def test_hsl_fails(self):
        self.site(style__css=STYLE + ".a { color: hsl(320 100% 50%); }\n")
        code, p = self.run_site()
        self.assertFails(p, "colour_not_token", "line 8: #FF00AA")

    def test_a_colour_name_fails(self):
        self.site(style__css=STYLE + ".a { border-color: HotPink; }\n")
        code, p = self.run_site()
        self.assertFails(p, "colour_not_token", "line 8: #FF69B4")

    def test_a_gradient_stop_fails(self):
        self.site(style__css=STYLE + ".a { background: linear-gradient(to right, var(--brand-ink) 0%,\n"
                                     "  #ff00aa 100%); }\n")
        code, p = self.run_site()
        self.assertFails(p, "colour_not_token", "line 9: #FF00AA")

    def test_a_kit_colour_at_any_alpha_passes(self):
        self.site(style__css=STYLE + ".a { color: #1a3c5e80; background: rgba(26, 60, 94, 0.5);\n"
                                     "  border-color: rgb(26 60 94 / 50%); outline-color: #C8553D;\n"
                                     "  box-shadow: 0 0 4px rgb(from var(--brand-clay) r g b / 40%);\n"
                                     "  caret-color: color-mix(in srgb, var(--brand-ink) 40%, transparent); }\n")
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []))

    def test_a_grey_passes_with_neutrals_and_fails_without(self):
        self.site(style__css=STYLE + ".a { color: #808080; background: white; border-color: rgb(20 20 20); }\n")
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []))
        self.write_json(os.path.join(self.brand, "kit.json"), a_kit(neutrals=False))
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["colour_not_token"]))
        self.assertTrue(any("#808080" in d for d in self.details(p, "colour_not_token")))

    def test_keywords_and_what_is_inside_var_are_not_colours(self):
        self.site(style__css=STYLE + ".a { color: inherit; background: initial; border-color: unset;\n"
                                     "  fill: currentcolor; stroke: transparent; color: var(--brand-ink, #ff00aa);\n"
                                     "  animation: tomato 1s; transition: color 0.2s; }\n")
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []))

    def test_a_colour_the_check_does_not_read_fails(self):
        self.site(style__css=STYLE + ".a { color: oklch(70% 0.2 330); }\n.b { color: rgb(var(--x) / 1); }\n")
        code, p = self.run_site()
        self.assertFails(p, "colour_not_token", "line 8: a colour written with oklch()",
                         "line 9: a colour written with rgb() that the check cannot read")

    def test_selectors_are_not_colours_and_nested_rules_are_read(self):
        self.site(style__css=STYLE + "#f0a { color: var(--brand-ink); }\n"
                                     ".a { b:hover #f0a { color: var(--brand-clay); }\n"
                                     "  & .c { color: red; } }\n")
        code, p = self.run_site()
        self.assertFails(p, "colour_not_token", "line 10: #FF0000")
        self.assertEqual(len(p["hard"]), 1)

    def test_svg_and_old_colour_attributes_are_colours_too(self):
        self.site(index__html=in_index('<svg width="10" height="10"><rect fill="#ff00aa" width="10" '
                                       'height="10"/></svg>\n<font color="ff00aa">x</font>\n'))
        code, p = self.run_site()
        self.assertFails(p, "colour_not_token", "line 15, in a fill attribute: #FF00AA",
                         "line 16, in a color attribute: #FF00AA")


class TypeTest(PageBase):
    def test_font_family_arial_is_font_not_kit(self):
        self.site(style__css=STYLE + ".a { font-family: Arial, sans-serif; }\n")
        code, p = self.run_site()
        self.assertFails(p, "font_not_kit", "style.css, line 8: a font-family", "(Didot, Avenir Next)")

    def test_font_shorthand_with_arial_is_font_not_kit_and_text_too_small(self):
        self.site(style__css=STYLE + ".a { font: 12px Arial; }\n")
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["font_not_kit", "text_too_small"]))
        self.assertIn("style.css, line 8: a font shorthand", self.details(p, "font_not_kit")[0])
        self.assertIn("12 px; the brand kit's smallest is 16 px", self.details(p, "text_too_small")[0])

    def test_the_kits_faces_and_brand_vars_pass(self):
        self.site(style__css=STYLE + ".a { font-family: \"Avenir Next\", sans-serif; }\n"
                                     ".b { font-family: didot; } .c { font-family: Avenir   Next; }\n"
                                     ".d { font: italic 700 1rem/1.5 var(--brand-body); } .e { font: inherit; }\n"
                                     ".f { font: var(--brand-heading); } .g { font-family: inherit !important; }\n"
                                     ".h { font-size: clamp(1rem, 2vw, 3rem); }\n"
                                     "@font-face { font-family: \"Didot\"; src: url(fonts/didot.otf); }\n")
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []))

    def test_a_var_other_than_the_brand_faces_is_font_not_kit(self):
        self.site(style__css=STYLE + ".a { font-family: var(--my-face); }\n")
        code, p = self.run_site()
        self.assertFails(p, "font_not_kit", "line 8")

    def test_font_size_12px_is_text_too_small(self):
        self.site(style__css=STYLE + ".a { font-size: 12px; }\n.b { font-size: min(14px, 2vw); }\n"
                                     ".c { font-size: max(12px, 1rem); }\n")
        code, p = self.run_site()
        self.assertFails(p, "text_too_small", "line 8: text set at 12 px", "line 9: text set at 14 px")
        self.assertEqual(len(p["hard"]), 2)

    def test_a_small_size_in_a_style_attribute_is_text_too_small(self):
        self.site(index__html=in_index('<small style="font-size:11.5PX">Fine print</small>\n'))
        code, p = self.run_site()
        self.assertFails(p, "text_too_small", "index.html, line 15, in a style attribute: text set at 11.5 px")


class ReportTest(PageBase):
    def report(self, obj, name="launch"):
        path = os.path.join(self.goal, "viewer", name, "report.json")
        os.makedirs(os.path.dirname(path))
        with open(path, "w") as fh:
            fh.write(obj if isinstance(obj, str) else json.dumps(obj))

    def test_a_report_with_11px_fails_only_with_report(self):
        self.site()
        self.report({"version": 1, "pages": [{"page": "index.html", "errors": [],
                                              "fonts": [{"family": "Avenir Next", "minPx": 18},
                                                        {"family": "ZEBRA", "minPx": 11}]}]})
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []))
        code, p = self.run_site("--report")
        self.assertEqual(code, 1)
        self.assertFails(p, "text_too_small", "measured text of 11 px on index.html (viewer/launch/report.json)")
        self.assertNotIn("ZEBRA", json.dumps(p))

    def test_a_report_missing_or_not_the_shape_is_ignored(self):
        self.site("launch-a")
        self.site("launch-b")
        self.site("launch-c")
        self.report("{ not json", "launch-a")
        self.report({"pages": {"fonts": 3}}, "launch-b")
        self.report("[" * 100000 + "]" * 100000, "launch-c")
        code, r = self.check("--report")
        self.assertEqual((code, [p["hard"] for p in r["pieces"]]), (0, [[], [], []]))


class AddressTest(PageBase):
    def test_a_script_from_outside_fails(self):
        self.site(index__html=in_index('<script src="https://x.example/a.js"></script>\n'))
        code, p = self.run_site()
        self.assertFails(p, "outside_address", "index.html, line 15: an address outside the site in a src attribute")

    def test_a_protocol_relative_css_url_fails(self):
        self.site(style__css=STYLE + ".a { background-image: url(//x/y.png); }\n")
        code, p = self.run_site()
        self.assertFails(p, "outside_address", "style.css, line 8: an address outside the site in a url()")

    def test_an_import_from_outside_fails(self):
        self.site(style__css='@import "http://x/fonts.css";\n' + STYLE)
        code, p = self.run_site()
        self.assertFails(p, "outside_address", "style.css, line 1: an address outside the site in an @import")

    def test_fetch_and_import_of_an_outside_address_fail(self):
        self.site(reveal__js=REVEAL + 'fetch("https://x.example/data.json");\n'
                                      'const m = await import("https://x.example/m.js");\n'
                                      'fetch("/data.json"); import("./local.js");\n')
        code, p = self.run_site()
        self.assertFails(p, "outside_address", "reveal.js, line 6: an address outside the site in a string passed "
                         "to fetch()", "reveal.js, line 7: an address outside the site in a string passed to import()")
        self.assertEqual(len(p["hard"]), 2)

    def test_a_srcset_with_one_outside_picture_fails(self):
        self.site(index__html=in_index('<img srcset="a.png 1x, https://x/b.png 2x" alt="Tower">\n'))
        code, p = self.run_site()
        self.assertFails(p, "outside_address", "in a srcset attribute")

    def test_a_link_to_the_outside_passes(self):
        self.site(index__html=in_index('<a href="https://example.com">Elsewhere</a>'
                                       '<map name="m"><area href="https://example.com" alt="Elsewhere"></map>\n'))
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []))

    def test_tricks_in_pages_attributes_and_styles_are_still_addresses(self):
        self.site(index__html=in_index(
            '<img src="&#104;ttps://x/a.png" alt="a">\n'                      # line 16: a character reference
            '<img src="\\\\x\\a.png" alt="b">\n'                             # 17: a backslash is a slash
            '<img src="ht\ntps://x/c.png" alt="c">\n'                         # 18: a line break is dropped
            '<button onclick="fetch(\'https://x\')">Go</button>\n',           # 20: an event attribute
            head='<base href="https://x/">\n'))                                # 8: a base for every address
        self.site("styles", style__css=STYLE + ".a { background: url(h\\74 tps://x/y.png); }\n"
                                               ".b { mask: image-set(\"https://x/m.png\" 1x); }\n")
        code, r = self.check()
        p = self.piece(r, "launch")
        self.assertEqual(codes(p), ["outside_address"])
        self.assertEqual([d.split(":")[0] for d in self.details(p, "outside_address")],
                         ["index.html, line 8", "index.html, line 16", "index.html, line 17", "index.html, line 18",
                          "index.html, line 20, in an event attribute"])
        styles = self.details(self.piece(r, "styles"), "outside_address")
        self.assertEqual([d.split(":")[0] for d in styles], ["style.css, line 8", "style.css, line 9"])

    def test_tricks_in_scripts_are_still_addresses(self):
        self.site(index__html=in_index(
            '<script type="module">import x from "https://x/m.js";\n'                       # line 15
            'new Worker("wss://x");\n'                                                       # 16
            'navigator.sendBeacon(`https://x/${a}`, `${b}`);</script>\n'                     # 17
            '<script>fetch("\\x68ttps://x"); const r = /fetch\\("/; fetch(r);\n'             # 18
            'fetch?.("//x");</script>\n'                                                     # 19
            '<script type="importmap">{"imports": {"m": "https://x/m.js"}}</script>\n'))     # 20
        code, p = self.run_site()
        self.assertEqual(codes(p), ["outside_address"])
        found = self.details(p, "outside_address")
        self.assertEqual([d.split(":")[0] for d in found], ["index.html, line %d, in a <script> block" % n
                                                             for n in range(15, 21)])
        for n, what in zip(range(15, 21), ("a module's address", "passed to Worker()", "passed to sendBeacon()",
                                           "passed to fetch()", "passed to fetch()", "an import map")):
            self.assertIn(what, found[n - 15])


class LogoTest(PageBase):
    def test_no_logo_in_the_header_with_page_required_is_no_logo(self):
        self.site(index__html=INDEX.replace('<img src="logo.png" alt="Sthyra">', "Sthyra"))
        code, p = self.run_site()
        self.assertFails(p, "no_logo", "index.html: no picture in its first <header> is the brand kit's logo "
                         "(logo.png)")

    def test_another_picture_or_a_logo_outside_the_header_is_no_logo(self):
        self.site(index__html=INDEX.replace("logo.png", "pictures/tower.png").replace(
            "</main>", '<img src="logo.png" alt="Sthyra"></main>'),
            pictures_x_tower__png=b"\x89PNG not the logo")
        code, p = self.run_site()
        self.assertFails(p, "no_logo")

    def test_a_logo_by_url_in_the_header_or_by_another_path_passes(self):
        self.site("one", index__html=INDEX.replace('<img src="logo.png" alt="Sthyra">',
                                                   '<span style="background: url(\'./img/../brandmark.png\')">'
                                                   'Sthyra</span>'),
                  brandmark__png=self.logo_bytes())
        self.site("two", index__html=INDEX.replace('src="logo.png"', 'src="/img/%6Cogo.png?v=2"'),
                  img_x_logo__png=self.logo_bytes())
        code, r = self.check()
        self.assertEqual((code, [p["hard"] for p in r["pieces"]]), (0, [[], []]))

    def test_no_header_is_no_logo_and_no_page_in_required_on_passes(self):
        self.site(index__html=INDEX.replace("<header", "<div").replace("</header>", "</div>"))
        code, p = self.run_site()
        self.assertFails(p, "no_logo", "has no <header>")
        kit = a_kit()
        kit["logo"]["requiredOn"] = ["carousel-last", "poster"]
        self.write_json(os.path.join(self.brand, "kit.json"), kit)
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []))

    def test_a_ttc_kit_font_is_soft_font_collection(self):
        kit = a_kit()
        kit["type"]["heading"]["file"] = "Didot.ttc"
        self.write_json(os.path.join(self.brand, "kit.json"), kit)
        self.site()
        code, p = self.run_site()
        self.assertEqual((code, p["result"], p["hard"], codes(p, "soft")), (0, "warn", [], ["font_collection"]))
        self.assertEqual(p["soft"][0], {"code": "font_collection", "where": "Didot.ttc", "detail": "Web pages cannot "
                         "use a font collection; pages show serif instead. Upload the .ttf or .otf."})


class DistrustTest(PageBase):
    def test_a_link_in_the_site_is_not_followed(self):
        outside = os.path.join(self.root, "outside")
        os.makedirs(outside)
        with open(os.path.join(outside, "loud.css"), "w") as fh:
            fh.write(".a { color: #ff00aa; font-family: Arial; }\n")
        folder = self.site()
        os.symlink(os.path.join(outside, "loud.css"), os.path.join(folder, "loud.css"))
        os.symlink(outside, os.path.join(folder, "more"))
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["could_not_check"]))
        self.assertEqual(sorted(e["detail"].split(" ")[0] for e in p["hard"]), ["loud.css", "more"])
        self.assertIn("follows no link", p["hard"][0]["detail"])

    def test_a_600_kb_css_is_could_not_check_naming_it(self):
        self.site(css_x_big__css=".a { color: var(--brand-ink); }\n" * 20000)
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["could_not_check"]))
        self.assertIn("css/big.css is more than 512 KB", p["hard"][0]["detail"])

    def test_more_than_4_mb_of_text_stops_at_the_file_that_goes_over(self):
        files = {"part%02d__css" % i: ".a { color: var(--brand-ink); }\n" * 15000 for i in range(9)}
        self.site(**files)
        code, p = self.run_site()
        self.assertEqual(codes(p), ["could_not_check"])
        self.assertIn("part08.css was not read", p["hard"][0]["detail"])

    def test_a_301st_entry_and_a_folder_7_deep_are_handled(self):
        folder = self.site()
        for i in range(300):
            open(os.path.join(folder, "f%03d.txt" % i), "w").close()
        start = time.monotonic()
        code, p = self.run_site()
        self.assertLess(time.monotonic() - start, 5)
        self.assertEqual(codes(p), ["could_not_check"])
        self.assertIn("more than 300 files and folders", p["hard"][0]["detail"])
        deep = self.site("deep")
        os.makedirs(os.path.join(deep, "a", "b", "c", "d", "e", "f"))
        code, r = self.check()
        d = self.piece(r, "deep")
        self.assertEqual(codes(d), ["could_not_check"])
        self.assertIn("a/b/c/d/e/f is too deep", d["hard"][0]["detail"])

    def quick(self, **files):
        self.site(**files)
        start = time.monotonic()
        code, p = self.run_site()
        self.assertLess(time.monotonic() - start, 2)
        return p

    def test_a_400_kb_line_of_brackets_finishes_quickly(self):
        for files in ({"style__css": STYLE + ".a { color: " + "(" * 400000 + "}\n"},
                      {"reveal__js": "(" * 400000 + "\n"},
                      {"reveal__js": "x = /" + "[" * 400000 + "\n"},
                      {"index__html": in_index("<p>" + "((((" * 100000 + "</p>\n")}):
            shutil.rmtree(os.path.join(self.goal, "site"), ignore_errors=True)
            p = self.quick(**files)
            self.assertEqual([e for e in p["hard"] if e["code"] != "could_not_check"], [], list(files))

    def test_a_400_kb_style_attribute_finishes_quickly(self):
        p = self.quick(index__html=in_index('<div style="' + "color: var(--brand-ink); " * 16000 + 'x: #ff00aa">'
                                            'x</div>\n'))
        self.assertEqual(codes(p), ["colour_not_token"])
        shutil.rmtree(os.path.join(self.goal, "site"))
        p = self.quick(index__html=in_index('<div style="' + "(" * 400000 + '">y</div>\n'))
        self.assertEqual(p["hard"], [])

    def test_no_detail_holds_page_text(self):
        secret = "ZEBRAQUOKKA"
        self.site(index__html=in_index(
            '<p class="%s" style="color: %s; font-family: %s; color: #ff00aa">%s</p>\n'
            '<img src="https://%s.example/a.png" alt="%s">\n'
            '<script>fetch("https://%s.example/");</script>\n' % ((secret,) * 7)),
            style__css=STYLE + "/* %s */ .%s { font: 12px %s; background: url(//%s/x.png); }\n" % ((secret,) * 4))
        self.write_json(os.path.join(self.goal, "viewer", "launch", "report.json"),
                        {"pages": [{"page": secret + " page", "fonts": [{"family": secret, "minPx": 9}]}]})
        code, r = self.check("--report")
        text = json.dumps(r)
        self.assertEqual(code, 1)
        self.assertNotIn(secret, text)
        self.assertNotIn(secret.lower(), text.lower())
        p = self.piece(r, "launch")
        self.assertEqual(codes(p), ["colour_not_token", "font_not_kit", "outside_address", "text_too_small"])

    def test_many_problems_stay_within_what_the_home_server_reads(self):
        rules = "".join(".c%d { color: #%06x; font-family: F%d; font-size: %dpx; background: url(//x/%d.png); }\n"
                        % (i, 0xFF0000 + i, i, 10, i) for i in range(200))
        self.site(style__css=STYLE + rules)
        code, p = self.run_site()
        self.assertEqual(code, 1)
        for c in ("colour_not_token", "font_not_kit", "outside_address", "text_too_small"):
            self.assertEqual(len(self.details(p, c)), 7, c)
            self.assertIn("and 194 more like this in this site", self.details(p, c)[-1])
        self.assertLessEqual(len(p["hard"]), 48)

    def test_a_utf16_page_is_read_as_the_browser_reads_it(self):
        page = in_index('<script src="https://x/a.js"></script>\n')
        self.site(index__html=b"\xff\xfe" + page.encode("utf-16-le"))
        code, p = self.run_site()
        self.assertFails(p, "outside_address", "index.html, line 15")


class KitAndWordsTest(PageBase):
    def test_no_kit_runs_only_the_address_and_word_rules(self):
        os.remove(os.path.join(self.brand, "kit.json"))
        self.site(style__css=STYLE + ".a { color: #ff00aa; font: 9px Arial; background: url(https://x/a.png); }\n",
                  index__html=in_index("<p>Always cheap.</p>\n"), kit__css=None, logo__png=None)
        code, p = self.run_site()
        self.assertEqual((code, codes(p), codes(p, "soft")), (1, ["banned_phrase", "outside_address"],
                                                              ["kit_missing"]))

    def test_the_words_on_a_page_get_the_word_rules(self):
        self.site(index__html=in_index("<p>We are che<b>ap</b> and <span>guaranteed</span>.</p>\n"
                                       '<img src="logo.png" alt="Elevate your home">\n'))
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["banned_phrase", "filler_phrase"]))
        self.assertEqual({e["where"] for e in p["hard"]}, {"index.html"})
        self.assertEqual(len(self.details(p, "banned_phrase")), 2)


class CommandTest(PageBase):
    def test_report_takes_no_value_and_the_plain_line_names_file_and_line(self):
        self.site(style__css=STYLE + ".a { color: #ff00aa; }\n")
        tool = os.path.join(self.bin, "brandcheck.py")
        r = subprocess.run([sys.executable, "-I", tool, "--report", "--state", self.state, "STH-7"], cwd=self.work,
                           capture_output=True, text=True, timeout=120)
        self.assertEqual((r.returncode, r.stderr), (1, ""))
        self.assertEqual(r.stdout, "site/launch: fail - colour_not_token (launch): style.css, line 8: #FF00AA is not "
                                   "one of the brand kit's colours; use the brand kit's var(--brand-…) colours.\n")
        r = subprocess.run([sys.executable, "-I", tool, "--state", self.state, "--report", "--report=x", "STH-7"],
                           cwd=self.work, capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
