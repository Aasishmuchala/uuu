"""Tests for the brand check on a site made with the Astryx kit (PLAN-ASTRYX T6). Run with the Artist's own Python:

    ~/.paperclip/uuu-engine/art/venv/bin/python -m unittest discover -s engine/art/tests -p 'test_brandcheck*.py'

Each test writes a site into a goal of a state folder of its own (as test_brandcheck_pages.py does): the kit's
folder copied from engine/astryx-kit/astryx, the example page from engine/astryx-kit/example (with the test kit's
logo), kit.css, and an astryx-theme.css the test writes into the brand folder and copies. The kit's list is put
beside the tool as install.sh puts it in state/art/tools.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    from test_brandcheck import codes  # noqa: E402
    from test_brandcheck_pages import PageBase, STYLE, REVEAL  # noqa: E402
except NameError:       # test_brandcheck.py names Pillow's colours at import: without Pillow it cannot be read
    raise unittest.SkipTest("the Artist's tools are not installed (run engine/art/install.sh); brand check tests "
                            "skipped")

ENGINE = os.path.dirname(os.path.dirname(HERE))
ART = os.path.join(ENGINE, "art")
KIT_DIR = os.path.join(ENGINE, "astryx-kit")
KIT = os.path.join(KIT_DIR, "astryx")
LIST = os.path.join(KIT_DIR, "astryx.lock.json")
EXAMPLE = os.path.join(KIT_DIR, "example")
REPO = os.path.dirname(ENGINE)

THEME = ("/* The brand kit as an Astryx theme, written by the home server on every save. Change it in Files, "
         "Brand kit. */\n:root { color-scheme: light; }\n"
         "[data-astryx-theme], html[data-theme=\"dark\"] [data-astryx-theme], [data-astryx-media] {\n"
         "  --color-accent: #1A3C5E;\n  --color-background-body: #E8DCC8;\n  --color-text-primary: #1A3C5E;\n"
         "  --font-family-heading: var(--brand-heading);\n  --font-family-body: var(--brand-body);\n}\n"
         "body { margin: 0; font-family: var(--font-family-body); background: var(--color-background-body); "
         "color: var(--color-text-primary); }\n")

# The example page as T4 lays it out, used only when engine/astryx-kit/example is not there yet.
EXAMPLE_INDEX = """<!doctype html>
<html lang="en" data-astryx-theme="neutral">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Example page</title>
<link rel="stylesheet" href="astryx/reset.css">
<link rel="stylesheet" href="astryx/astryx.css">
<link rel="stylesheet" href="astryx/theme.css">
<link rel="stylesheet" href="kit.css">
<link rel="stylesheet" href="astryx-theme.css">
<link rel="stylesheet" href="style.css">
<script type="importmap">
{
  "imports": {
    "react": "./astryx/react.js",
    "react/jsx-runtime": "./astryx/jsx-runtime.js",
    "react-dom": "./astryx/react-dom.js",
    "react-dom/client": "./astryx/react-dom-client.js",
    "@astryxdesign/core": "./astryx/core.js",
    "@astryxdesign/theme-neutral": "./astryx/theme-neutral.js"
  }
}
</script>
</head>
<body>
<header class="page-header"><img src="logo.svg" alt="The company's logo" height="32"></header>
<main data-astryx-root></main>
<script type="module" src="app.js"></script>
</body>
</html>
"""
EXAMPLE_APP = """import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Card, Grid, Heading, Text } from '@astryxdesign/core';
const h = React.createElement;
createRoot(document.querySelector('[data-astryx-root]')).render(
  h(Grid, { columns: 3 }, h(Card, null, h(Heading, { level: 2 }, 'First card'), h(Text, null, 'Words.'),
    h(Button, { label: 'Go' }))));
"""
EXAMPLE_STYLE = ".page-header { display: flex; padding-block: var(--spacing-4, 1rem); }\n"


def example(name):
    path = os.path.join(EXAMPLE, name)
    if all(os.path.isfile(os.path.join(EXAMPLE, n)) for n in ("index.html", "app.js", "style.css")):
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    else:
        text = {"index.html": EXAMPLE_INDEX, "app.js": EXAMPLE_APP, "style.css": EXAMPLE_STYLE}[name]
    # the test kit's logo is logo.png (test_kit.a_kit)
    return text.replace('src="logo.svg"', 'src="logo.png"') if name == "index.html" else text


class AstryxBase(PageBase):
    def setUp(self):
        super().setUp()
        with open(os.path.join(self.brand, "astryx-theme.css"), "w", encoding="utf-8") as fh:
            fh.write(THEME)
        shutil.copy(LIST, os.path.join(self.bin, "astryx.lock.json"))

    def astryx_site(self, name="launch", kit=True, theme=True, **files):
        """site/<name>/ as the example: index.html, app.js, style.css, kit.css, logo.png, astryx-theme.css and the
        kit's folder; a keyword (dots and slashes as __ and _x_) replaces a file or, with None, leaves it out."""
        want = {"index.html": example("index.html"), "app.js": example("app.js"), "style.css": example("style.css"),
                "reveal.js": None}
        for k, v in files.items():
            want[k.replace("_x_", "/").replace("__", ".")] = v
        want = {k.replace("/", "_x_").replace(".", "__"): v for k, v in want.items()}
        folder = self.site(name, **want)
        if kit:
            shutil.copytree(KIT, os.path.join(folder, "astryx"), dirs_exist_ok=True)
        if theme:
            shutil.copy(os.path.join(self.brand, "astryx-theme.css"), folder)
        return folder

    def lines(self, p, code):
        return [e for e in p["hard"] if e["code"] == code]


class AstryxGoodTest(AstryxBase):
    def test_the_example_site_with_the_kit_and_the_theme_passes(self):
        self.astryx_site()
        code, p = self.run_site()
        self.assertEqual((code, p["result"], p["hard"], p["soft"]), (0, "pass", [], []), json.dumps(p["hard"]))

    def test_the_kit_is_the_whole_listed_folder(self):
        with open(LIST, encoding="utf-8") as fh:
            names = sorted(f["name"] for f in json.load(fh)["files"])
        self.assertEqual(sorted(os.listdir(KIT)), names)

    def test_a_kit_colour_in_a_script_passes(self):
        self.astryx_site(app__js=example("app.js") + "const accent = { color: '#1A3C5E' };\n")
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []), json.dumps(p["hard"]))


class AstryxKitTest(AstryxBase):
    def test_one_byte_changed_in_core_js_is_kit_file_changed(self):
        folder = self.astryx_site()
        path = os.path.join(folder, "astryx", "core.js")
        with open(path, "rb") as fh:
            data = bytearray(fh.read())
        data[100] = (data[100] + 1) % 256
        with open(path, "wb") as fh:
            fh.write(bytes(data))
        code, p = self.run_site()
        self.assertEqual(code, 1)
        found = self.lines(p, "kit_file_changed")
        self.assertEqual([e["where"] for e in found], ["astryx/core.js"])
        self.assertIn("not the engine's Astryx kit byte for byte", found[0]["detail"])

    def test_an_extra_file_in_the_kit_is_kit_file_changed(self):
        self.astryx_site(astryx_x_evil__js="export const x = 1;\n")
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["kit_file_changed"]))
        self.assertEqual([e["where"] for e in self.lines(p, "kit_file_changed")], ["astryx/evil.js"])

    def test_a_folder_inside_the_kit_is_kit_file_changed(self):
        self.astryx_site(astryx_x_sub_x_x__js="export const x = 1;\n")
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["kit_file_changed"]))
        self.assertEqual([e["where"] for e in self.lines(p, "kit_file_changed")], ["astryx/sub"])

    def test_an_empty_folder_inside_the_kit_is_kit_file_changed(self):
        folder = self.astryx_site()
        os.makedirs(os.path.join(folder, "astryx", "empty"))
        code, p = self.run_site()
        self.assertEqual([e["where"] for e in self.lines(p, "kit_file_changed")], ["astryx/empty"])

    def test_a_listed_name_over_2_mb_is_kit_file_changed(self):
        folder = self.astryx_site()
        with open(os.path.join(folder, "astryx", "react.js"), "wb") as fh:
            fh.write(b"/* */\n" * (2 * 1024 * 1024 // 6 + 10))
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertEqual([e["where"] for e in self.lines(p, "kit_file_changed")], ["astryx/react.js"])

    def test_more_than_five_are_named_five_and_counted(self):
        self.astryx_site(**{"astryx_x_e%d__js" % i: "x\n" for i in range(8)})
        code, p = self.run_site()
        found = self.lines(p, "kit_file_changed")
        self.assertEqual([e["where"] for e in found[:5]], ["astryx/e%d.js" % i for i in range(5)])
        self.assertEqual(len(found), 6)
        self.assertIn("and 3 more", found[5]["detail"])

    def test_a_link_in_the_kit_is_refused_as_any_link(self):
        folder = self.astryx_site()
        core = os.path.join(folder, "astryx", "core.js")
        os.remove(core)
        os.symlink(os.path.join(KIT, "core.js"), core)
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertTrue(any("astryx/core.js is a link" in e["detail"] for e in self.lines(p, "could_not_check")),
                        json.dumps(p["hard"]))

    def test_no_list_installed_is_could_not_check(self):
        os.remove(os.path.join(self.bin, "astryx.lock.json"))
        self.astryx_site()
        code, p = self.run_site()
        found = self.lines(p, "could_not_check")
        self.assertEqual(code, 1)
        self.assertIn("the Astryx kit's list is not installed, so astryx/ was not compared",
                      [e["detail"] for e in found])
        self.assertNotIn("kit_file_changed", codes(p))

    def test_a_list_that_is_not_the_shape_is_could_not_check(self):
        for bad in ("not json", json.dumps({"files": [{"name": "../x.js", "bytes": 1, "sha256": "0" * 64}]}),
                    json.dumps({"files": [{"name": "x.js", "bytes": 1, "sha256": "zz"}]})):
            with open(os.path.join(self.bin, "astryx.lock.json"), "w") as fh:
                fh.write(bad)
            shutil.rmtree(os.path.join(self.goal, "site"), ignore_errors=True)
            self.astryx_site()
            code, p = self.run_site()
            self.assertEqual(code, 1)
            self.assertTrue(any("Astryx kit's list" in e["detail"] for e in self.lines(p, "could_not_check")))

    def test_astryx_below_the_top_is_the_makers_own_and_read(self):
        folder = self.astryx_site()
        os.makedirs(os.path.join(folder, "pages", "astryx"))
        shutil.copy(os.path.join(KIT, "core.js"), os.path.join(folder, "pages", "astryx", "core.js"))
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertTrue(any(e["detail"].startswith("pages/astryx/core.js is more than 512 KB")
                            for e in self.lines(p, "could_not_check")), json.dumps(p["hard"]))

    def test_a_site_with_no_top_astryx_reads_a_nested_copy_as_its_own(self):
        folder = self.site()
        os.makedirs(os.path.join(folder, "pages", "astryx"))
        shutil.copy(os.path.join(KIT, "astryx.css"), os.path.join(folder, "pages", "astryx", "astryx.css"))
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertIn("colour_not_token", codes(p))
        self.assertNotIn("kit_file_changed", codes(p))


class AstryxThemeTest(AstryxBase):
    def test_a_changed_theme_is_tokens_file_changed(self):
        self.astryx_site(theme=False, **{"astryx-theme__css": THEME + "/* mine */\n"})
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertIn("astryx-theme.css at the site's top is not brand/astryx-theme.css byte for byte",
                      [e["detail"] for e in self.lines(p, "tokens_file_changed")][0])

    def test_a_missing_theme_is_tokens_file_changed(self):
        self.astryx_site(theme=False)
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["tokens_file_changed"]))
        self.assertIn("there is no astryx-theme.css at the site's top", self.lines(p, "tokens_file_changed")[0]["detail"])

    def test_an_unreadable_brand_theme_is_could_not_check(self):
        self.astryx_site()
        os.remove(os.path.join(self.brand, "astryx-theme.css"))
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertIn("astryx-theme.css could not be read", self.lines(p, "could_not_check")[0]["detail"])

    def test_a_theme_file_in_a_site_with_no_kit_is_the_makers_css(self):
        self.site(**{"astryx-theme__css": ":root { --color-accent: #ff0000; }\n"})
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["colour_not_token"]))
        self.assertIn("astryx-theme.css, line 1", self.lines(p, "colour_not_token")[0]["detail"])


class AstryxMakerRulesTest(AstryxBase):
    def test_a_red_in_a_scripts_style_is_colour_not_token(self):
        self.astryx_site(app__js=example("app.js") + "const loud = h('p', { style: { color: \"#ff0000\" } });\n")
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["colour_not_token"]))
        self.assertIn("#FF0000", self.lines(p, "colour_not_token")[0]["detail"])
        self.assertIn("app.js, line", self.lines(p, "colour_not_token")[0]["detail"])

    def test_a_colour_function_in_a_script_is_refused(self):
        self.astryx_site(app__js=example("app.js") + "const s = `color: rgb(26 60 94)`;\n")
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["colour_not_token"]))

    def test_an_outside_fetch_in_the_script_is_outside_address(self):
        self.astryx_site(app__js=example("app.js") + 'fetch("https://example.com");\n')
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["outside_address"]))

    def test_setting_a_theme_token_in_the_makers_css_is_refused(self):
        self.astryx_site(style__css=example("style.css") + ":root { --color-accent: var(--brand-sun); }\n")
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["colour_not_token"]))
        self.assertIn("only astryx-theme.css may set", self.lines(p, "colour_not_token")[0]["detail"])

    def test_every_theme_prefix_is_refused_in_css_style_and_property(self):
        cases = (("style__css", example("style.css") + ".a { --font-family-body: serif; }\n", "font_not_kit"),
                 ("style__css", example("style.css") + ".a { --text-body-size: 0.5rem; }\n", "text_too_small"),
                 ("style__css", example("style.css") + ".a { --radius-element: 0; }\n", "tokens_file_changed"),
                 ("style__css", example("style.css") + "@property --shadow-high { syntax: '*'; inherits: true; }\n",
                  "tokens_file_changed"),
                 ("index__html", example("index.html").replace("<main data-astryx-root>",
                                                               '<main data-astryx-root style="--color-accent: inherit">'),
                  "colour_not_token"))
        for key, text, want in cases:
            shutil.rmtree(os.path.join(self.goal, "site"), ignore_errors=True)
            self.astryx_site(**{key: text})
            code, p = self.run_site()
            self.assertEqual((code, codes(p)), (1, [want]), (key, text[-80:], json.dumps(p["hard"])))
            self.assertIn("only astryx-theme.css may set", self.lines(p, want)[0]["detail"])

    def test_a_theme_token_in_a_site_with_no_kit_is_not_refused(self):
        self.site(style__css=STYLE + ".a { --color-accent: var(--brand-ink); }\n")
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []))


class NoAstryxUnchangedTest(AstryxBase):
    """A site with no astryx/ gives the same answer as the check before PLAN-ASTRYX T6, byte for byte."""

    def old_tool(self):
        r = subprocess.run(["git", "-C", REPO, "show", "build/v5-cook:engine/art/brandcheck.py"],
                           capture_output=True, timeout=30)
        if r.returncode != 0 or not r.stdout:
            self.skipTest("build/v5-cook's brandcheck.py is not in this repo")
        old = os.path.join(self.root, "oldbin")
        os.makedirs(old)
        for f in os.listdir(self.bin):
            shutil.copy(os.path.join(self.bin, f), old)
        with open(os.path.join(old, "brandcheck.py"), "wb") as fh:
            fh.write(r.stdout)
        return old

    def answer(self, folder):
        r = subprocess.run([sys.executable, "-I", os.path.join(folder, "brandcheck.py"), "--json", "--state",
                            self.state, "STH-7"], cwd=self.work, capture_output=True, timeout=120)
        return r.returncode, r.stdout, r.stderr

    def test_sites_with_no_kit_give_the_old_answer(self):
        old = self.old_tool()
        shutil.copy(os.path.join(ART, "brandcheck.py"), self.bin)
        self.site("good")
        self.site("loud", style__css=STYLE + ".a { color: #ff00aa; --color-accent: #ff0000; }\n",
                  reveal__js=REVEAL + 'fetch("https://x.example/a"); const c = "#ff0000";\n')
        self.site("themed", **{"astryx-theme__css": ":root { --font-family-body: serif; }\n"})
        folder = self.site("nested")
        os.makedirs(os.path.join(folder, "pages", "astryx"))
        shutil.copy(os.path.join(KIT, "theme.css"), os.path.join(folder, "pages", "astryx", "theme.css"))
        new = self.answer(self.bin)
        self.assertEqual(new, self.answer(old))
        self.assertEqual(new[0], 1)


if __name__ == "__main__":
    unittest.main()
