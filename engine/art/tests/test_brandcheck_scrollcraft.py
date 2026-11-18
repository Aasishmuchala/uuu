"""Tests for the brand check on a site that carries the scroll-craft kit (PLAN-ASTRYX T13). Run with the Artist's own
Python:

    ~/.paperclip/uuu-engine/art/venv/bin/python -m unittest discover -s engine/art/tests -p 'test_brandcheck*.py'

The plain-kit example (engine/scrollcraft-kit/example-plain) and the Astryx example (engine/scrollcraft-kit/example)
are written into a goal of a state folder of the test's own, with the kit's folder copied from
engine/scrollcraft-kit/scrollcraft and its list beside the tool as install.sh puts it in state/art/tools. The test
kit's colours are ink, sand and clay, so the plain page's four roles are set from those.
"""
import json
import os
import shutil
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    from test_brandcheck import codes  # noqa: E402
    from test_brandcheck_astryx import AstryxBase, LIST as ASTRYX_LIST  # noqa: E402,F401
except NameError:
    raise unittest.SkipTest("the Artist's tools are not installed (run engine/art/install.sh); brand check tests "
                            "skipped")

ENGINE = os.path.dirname(os.path.dirname(HERE))
SC_DIR = os.path.join(ENGINE, "scrollcraft-kit")
SC = os.path.join(SC_DIR, "scrollcraft")
SC_LIST = os.path.join(SC_DIR, "scrollcraft.lock.json")
SITE_KIT = os.path.join(ENGINE, "site-kit")


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as fh:
        return fh.read()


def plain_index():
    return read(SC_DIR, "example-plain", "index.html").replace('src="logo.svg"', 'src="logo.png"')


def plain_style():
    return (read(SC_DIR, "example-plain", "style.css").replace("--brand-paper", "--brand-sand")
            .replace("--brand-night", "--brand-ink").replace("--brand-sun", "--brand-clay"))


class ScrollBase(AstryxBase):
    def setUp(self):
        super().setUp()
        shutil.copy(SC_LIST, os.path.join(self.bin, "scrollcraft.lock.json"))

    def plain_site(self, name="launch", kit=True, **files):
        want = {"index__html": plain_index(), "style__css": plain_style(), "reveal__js": None,
                "reset__css": read(SITE_KIT, "reset.css"), "layout__css": read(SITE_KIT, "layout.css")}
        want.update(files)
        folder = self.site(name, **want)
        if kit:
            shutil.copytree(SC, os.path.join(folder, "scrollcraft"))
        self.write_planes(folder)
        return folder

    def astryx_scroll_site(self, name="launch", **files):
        want = {"index__html": read(SC_DIR, "example", "index.html").replace('src="logo.svg"', 'src="logo.png"'),
                "app__js": read(SC_DIR, "example", "app.js"), "style__css": read(SC_DIR, "example", "style.css")}
        want.update(files)
        folder = self.astryx_site(name, **want)
        shutil.copytree(SC, os.path.join(folder, "scrollcraft"))
        self.write_planes(folder)
        return folder

    @staticmethod
    def write_planes(folder):
        for n in ("hero-back.png", "hero-front.png"):
            shutil.copy(os.path.join(folder, "logo.png"), os.path.join(folder, n))


class ScrollGoodTest(ScrollBase):
    def test_the_plain_example_with_the_kit_passes(self):
        self.plain_site()
        code, p = self.run_site()
        self.assertEqual((code, p["result"], p["hard"], p["soft"]), (0, "pass", [], []), json.dumps(p["hard"]))

    def test_the_astryx_example_with_the_kit_passes(self):
        self.astryx_scroll_site()
        code, p = self.run_site()
        self.assertEqual((code, p["result"], p["hard"], p["soft"]), (0, "pass", [], []), json.dumps(p["hard"]))

    def test_without_the_folder_the_vendored_files_are_read_as_the_makers_and_fail(self):
        folder = self.plain_site(kit=False)
        os.makedirs(os.path.join(folder, "vendor"))
        for n in ("scrollcraft.css", "scrollcraft.js"):
            shutil.copy(os.path.join(SC, n), os.path.join(folder, "vendor", n))
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertIn("colour_not_token", codes(p))


class ScrollKitChangedTest(ScrollBase):
    def test_a_changed_byte_in_the_script_is_kit_file_changed(self):
        folder = self.plain_site()
        path = os.path.join(folder, "scrollcraft", "scrollcraft.js")
        with open(path, "ab") as fh:
            fh.write(b"\n// one more line\n")
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertFails(p, "kit_file_changed", "scroll-craft kit")
        self.assertEqual([e["where"] for e in p["hard"]], ["scrollcraft/scrollcraft.js"])

    def test_an_extra_file_and_a_folder_inside_are_kit_file_changed(self):
        folder = self.plain_site()
        with open(os.path.join(folder, "scrollcraft", "evil.js"), "w") as fh:
            fh.write("fetch('https://example.com')\n")
        os.makedirs(os.path.join(folder, "scrollcraft", "sub"))
        with open(os.path.join(folder, "scrollcraft", "sub", "x.css"), "w") as fh:
            fh.write("body { color: red; }\n")
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertEqual(sorted(e["where"] for e in p["hard"] if e["code"] == "kit_file_changed"),
                         ["scrollcraft/evil.js", "scrollcraft/sub"])

    def test_a_link_in_the_folder_is_refused(self):
        folder = self.plain_site()
        os.unlink(os.path.join(folder, "scrollcraft", "scrollcraft.js"))
        os.symlink(os.path.join(SC, "scrollcraft.js"), os.path.join(folder, "scrollcraft", "scrollcraft.js"))
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertNotEqual(p["result"], "pass")

    def test_no_list_installed_is_could_not_check(self):
        self.plain_site()
        os.unlink(os.path.join(self.bin, "scrollcraft.lock.json"))
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertIn("could_not_check", codes(p))
        self.assertTrue(any("scroll-craft kit's list is not installed" in d for d in self.details(p, "could_not_check")))

    def test_a_scrollcraft_folder_below_the_top_is_the_makers_own(self):
        folder = self.plain_site()
        shutil.copytree(SC, os.path.join(folder, "pages", "scrollcraft"))
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertIn("colour_not_token", codes(p))


class ScrollRefusedTest(ScrollBase):
    def test_drift_is_refused(self):
        self.plain_site(index__html=plain_index().replace('data-sc-span="2.6"', 'data-sc-span="2.6" data-sc-drift="#1A3C5E"'))
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertFails(p, "colour_not_token", "data-sc-drift blends")

    def test_grain_is_refused_in_a_script_too(self):
        self.astryx_scroll_site(app__js=read(SC_DIR, "example", "app.js")
                                + "\nconst grain = h('div', { className: 'sc-grain' });\n")
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertFails(p, "colour_not_token", "sc-grain draws noise")

    def test_a_colour_of_its_own_on_a_role_is_refused(self):
        self.plain_site(style__css=plain_style().replace("var(--brand-clay)", "#FF0000"))
        code, p = self.run_site()
        self.assertEqual(code, 1)
        self.assertIn("colour_not_token", codes(p))


class ScrollAddressTest(ScrollBase):
    """Fable's review (T12): the hashed scrollcraft.js fetches what data-sc-src, data-sc-src-mobile and the template of
    data-sc-sequence name, and on a site with scrollcraft/ any string of the maker's script may become one."""
    STAGE = 'data-sc-span="2.6"'

    def with_attr(self, attr):
        return plain_index().replace(self.STAGE, self.STAGE, 1).replace(
            '<div data-sc-stage class="argument">', '<div data-sc-stage class="argument">' + attr, 1)

    def test_an_outside_clip_or_frame_template_is_outside_address(self):
        for attr in ('<video data-sc-src="https://example.com/a.mp4"></video>',
                     '<video data-sc-src="clip.mp4" data-sc-src-mobile="//example.com/m.mp4"></video>',
                     '<canvas data-sc-sequence="//example.com/f/{i}.webp:120:1"></canvas>',
                     '<canvas data-sc-sequence=" https://example.com/f/{i}.webp:120:1"></canvas>'):
            shutil.rmtree(os.path.join(self.goal, "site"), ignore_errors=True)
            self.plain_site(index__html=self.with_attr(attr))
            code, p = self.run_site()
            self.assertEqual((code, codes(p)), (1, ["outside_address"]), (attr, json.dumps(p["hard"])))

    def test_the_sites_own_clip_and_frames_pass(self):
        self.plain_site(index__html=self.with_attr(
            '<video data-sc-src="clip.mp4" data-sc-src-mobile="clip-m.mp4"></video>'
            '<canvas data-sc-sequence="frames/{i}.webp:120:1"></canvas>'))
        code, p = self.run_site()
        self.assertNotIn("outside_address", codes(p), json.dumps(p["hard"]))

    def test_an_outside_string_in_a_script_on_a_plain_scrollcraft_site_is_outside_address(self):
        for extra in ("const clip = 'https://example.com/a.mp4';\n",
                      "const clip = `${base}//example.com/a.mp4`;\n"):
            shutil.rmtree(os.path.join(self.goal, "site"), ignore_errors=True)
            self.plain_site(**{"more__js": extra})
            code, p = self.run_site()
            self.assertEqual((code, codes(p)), (1, ["outside_address"]), (extra, json.dumps(p["hard"])))

    def test_an_outside_clip_drawn_by_an_astryx_script_is_outside_address(self):
        self.astryx_scroll_site(app__js=read(SC_DIR, "example", "app.js")
                                + "\nconst v = h('video', { 'data-sc-src': 'https://example.com/a.mp4' });\n")
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["outside_address"]), json.dumps(p["hard"]))


if __name__ == "__main__":
    unittest.main()
