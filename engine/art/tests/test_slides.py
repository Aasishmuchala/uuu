"""Tests for engine/art/slides.py. Run with the Artist's own Python:

    ~/.paperclip/uuu-engine/art/venv/bin/python -m unittest discover -s engine/art/tests -p 'test_slides.py'

Skipped, with a message, when Pillow is not installed (engine/art/install.sh).
The scripts here are our own, so running them outside the fence is fine.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLIDES = os.path.join(ART, "slides.py")
FONTMAP = os.path.join(ART, "fontmap.json")

try:
    from PIL import Image
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False


def carousel(n=3, w=1080, h=1350, text="Words on slide %d", extra=""):
    """A script that lays out n flat slides with a headline each, in the brand's typeface."""
    return ("from PIL import Image, ImageDraw\n"
            "colours = [(27, 27, 31), (244, 162, 97), (42, 157, 143), (233, 196, 106)]\n"
            "slides, texts = [], []\n"
            "for i in range(%d):\n"
            "    im = Image.new('RGB', (%d, %d), colours[i %% 4])\n"
            "    words = %r %% (i + 1)\n"
            "    ImageDraw.Draw(im).text((80, 120), words, font=font('Georgia', 72), fill=(255, 255, 255))\n"
            "    slides.append(im)\n"
            "    texts.append(words)\n"
            "title = 'Launch carousel'\n%s" % (n, w, h, text, extra))


@unittest.skipUnless(HAVE_PIL, "the Artist's tools are not installed (run engine/art/install.sh); slide tests skipped")
class SlidesTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="uuu-slides-test-")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_slides(self, name, text):
        with open(os.path.join(self.dir, name), "w", encoding="utf-8") as fh:
            fh.write(text)
        return subprocess.run([sys.executable, SLIDES, name], cwd=self.dir,
                              capture_output=True, text=True, timeout=120)

    def read_json(self, name):
        with open(os.path.join(self.dir, name), encoding="utf-8") as fh:
            return json.load(fh)

    def files(self):
        return sorted(os.listdir(self.dir))

    def assertProblem(self, r, script):
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertEqual(r.stdout, "")
        lines = r.stderr.strip().splitlines()
        self.assertEqual(len(lines), 1, r.stderr)
        self.assertTrue(lines[0].startswith("slides: "), r.stderr)
        self.assertEqual(self.files(), [script], "nothing is written on a problem")

    def test_a_good_script_writes_the_slides_contact_sheet_words_and_manifest(self):
        r = self.run_slides("launch.py", carousel(3, extra="sources = ['team-photo.jpg']\n"))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, "launch: 3 slides of 1080 × 1350. "
                                   "Wrote slide-01.png to slide-03.png, contact.png, slides.json.\n")
        self.assertEqual(self.files(), ["contact.png", "launch.py", "manifest.json", "slide-01.png",
                                        "slide-02.png", "slide-03.png", "slides.json"])
        for f in ("slide-01.png", "slide-02.png", "slide-03.png"):
            with Image.open(os.path.join(self.dir, f)) as im:
                self.assertEqual(im.format, "PNG")
                self.assertEqual(im.size, (1080, 1350))
        with Image.open(os.path.join(self.dir, "slide-02.png")) as im:
            self.assertEqual(im.convert("RGB").getpixel((5, 5)), (244, 162, 97))
        with Image.open(os.path.join(self.dir, "contact.png")) as im:
            self.assertEqual(im.size, (2160, 900))
            self.assertLessEqual(im.size[0], 2160)
        m = self.read_json("manifest.json")
        self.assertEqual(set(m), {"name", "title", "kind", "slides", "size", "data", "contact",
                                  "script", "made_at"})
        self.assertEqual((m["name"], m["title"], m["kind"], m["data"], m["contact"], m["script"]),
                         ("launch", "Launch carousel", "slides", "slides.json", "contact.png", "launch.py"))
        self.assertEqual(m["slides"], ["slide-01.png", "slide-02.png", "slide-03.png"])
        self.assertEqual(m["size"], {"w": 1080, "h": 1350})
        self.assertRegex(m["made_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")

    def test_slides_json_holds_the_words(self):
        r = self.run_slides("launch.py", carousel(2, 1080, 1080, text="Five things we learned, part %d"))
        self.assertEqual(r.returncode, 0, r.stderr)
        data = self.read_json("slides.json")
        self.assertEqual(data, {"slides": [
            {"file": "slide-01.png", "w": 1080, "h": 1080, "text": "Five things we learned, part 1"},
            {"file": "slide-02.png", "w": 1080, "h": 1080, "text": "Five things we learned, part 2"}]})
        with Image.open(os.path.join(self.dir, "contact.png")) as im:
            self.assertEqual(im.size, (2160, 1080))

    def test_ten_slides_fit_a_contact_sheet_2160_wide(self):
        r = self.run_slides("ten.py", carousel(10))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Wrote slide-01.png to slide-10.png", r.stdout)
        with Image.open(os.path.join(self.dir, "contact.png")) as im:
            self.assertEqual(im.size, (2160, 270))

    def test_slides_left_from_a_longer_run_are_removed(self):
        self.assertEqual(self.run_slides("launch.py", carousel(4)).returncode, 0)
        r = self.run_slides("launch.py", carousel(2))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual([f for f in self.files() if f.startswith("slide-")], ["slide-01.png", "slide-02.png"])
        self.assertEqual(self.read_json("manifest.json")["slides"], ["slide-01.png", "slide-02.png"])

    def test_one_slide_is_refused(self):
        r = self.run_slides("one.py", carousel(1))
        self.assertProblem(r, "one.py")
        self.assertIn("2 to 10", r.stderr)

    def test_eleven_slides_are_refused(self):
        r = self.run_slides("eleven.py", carousel(11))
        self.assertProblem(r, "eleven.py")
        self.assertIn("2 to 10", r.stderr)

    def test_mixed_sizes_are_refused(self):
        script = ("from PIL import Image\n"
                  "slides = [Image.new('RGB', (1080, 1350)), Image.new('RGB', (1080, 1080))]\n"
                  "texts = ['a', 'b']\n")
        r = self.run_slides("mixed.py", script)
        self.assertProblem(r, "mixed.py")
        self.assertIn("same size", r.stderr)

    def test_a_slide_of_1000_by_1000_is_refused(self):
        r = self.run_slides("small.py", carousel(2, 1000, 1000))
        self.assertProblem(r, "small.py")
        self.assertIn("1080 × 1350 or 1080 × 1080", r.stderr)

    def test_a_700_character_text_is_refused(self):
        script = carousel(2) + "texts[1] = 'x' * 700\n"
        r = self.run_slides("long.py", script)
        self.assertProblem(r, "long.py")
        self.assertIn("at most 600", r.stderr)

    def test_texts_must_match_the_slides(self):
        for extra in ("del texts\n", "texts = texts[:1]\n", "texts = [1, 2]\n"):
            with self.subTest(extra=extra):
                r = self.run_slides("bad.py", carousel(2) + extra)
                self.assertProblem(r, "bad.py")

    def test_a_font_name_not_in_the_map_falls_back(self):
        script = carousel(2) + (
            "f = font('Comic Nonesuch', 64)\n"
            "ImageDraw.Draw(slides[0]).text((80, 400), 'Fallback', font=f, fill=(255, 255, 255))\n"
            "from PIL import ImageFont\n"
            "assert isinstance(f, (ImageFont.FreeTypeFont, ImageFont.ImageFont)), type(f)\n"
            "known = font('Georgia', 64)\n"
            "assert isinstance(known, ImageFont.FreeTypeFont) and known.getname()[0] == 'Georgia', known.getname()\n"
            "assert font('Georgia', 64, bold=True).getname()[1] == 'Bold'\n")
        r = self.run_slides("fallback.py", script)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.endswith(" Pillow's own font stood in for: Comic Nonesuch.\n"), r.stdout)

    def test_a_failing_script_is_one_line_with_its_line_number(self):
        r = self.run_slides("broken.py", "print('hello')\nraise ValueError('no ink')\n")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout, "", "what the script prints goes to stderr, never into the plain line")
        self.assertEqual(r.stderr.strip().splitlines()[-1],
                         "slides: the script failed on line 2: ValueError: no ink")
        self.assertEqual(self.files(), ["broken.py"])

    def test_a_bad_name_is_refused(self):
        r = self.run_slides("Launch_1.py", carousel(2))
        self.assertProblem(r, "Launch_1.py")

    def test_a_script_in_another_folder_is_refused_and_nothing_is_written_there(self):
        other = os.path.join(self.dir, "other")
        os.makedirs(other)
        with open(os.path.join(other, "launch.py"), "w", encoding="utf-8") as fh:
            fh.write(carousel(3))
        for arg in ("other/launch.py", os.path.join(other, "launch.py"), "./launch.py"):
            r = subprocess.run([sys.executable, SLIDES, arg], cwd=self.dir, capture_output=True, text=True, timeout=120)
            self.assertEqual(r.returncode, 1, arg)
            self.assertIn("no folder in front", r.stderr)
        self.assertEqual(sorted(os.listdir(other)), ["launch.py"])
        self.assertEqual(self.files(), ["other"])


class FontMapTest(unittest.TestCase):
    def test_the_seven_typefaces_of_the_brand_form_map_to_real_files(self):
        with open(FONTMAP, encoding="utf-8") as fh:
            m = json.load(fh)
        self.assertEqual(sorted(m), sorted(["Helvetica Neue", "Avenir Next", "Futura", "Gill Sans",
                                            "Georgia", "Baskerville", "Didot"]))
        for name, paths in m.items():
            self.assertTrue(isinstance(paths, list) and paths, name)
            for p in paths:
                self.assertTrue(p.startswith("/System/Library/Fonts/"), p)
                if sys.platform == "darwin":
                    self.assertTrue(os.path.isfile(p), p)


BEFORE_THE_KIT = "faf7f1b"      # the commit before the tools took the brand kit (PLAN-V5 T10)


def tool_before_the_kit(name):
    """engine/art/<name> as it was before the kit, or None when git cannot say."""
    try:
        r = subprocess.run(["git", "-C", ART, "show", "%s:engine/art/%s" % (BEFORE_THE_KIT, name)],
                           capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout if r.returncode == 0 and r.stdout else None


KIT_SCRIPT = """from PIL import Image, ImageDraw
bg, ink = kit.colour("sand"), kit.colour("ink")
m = kit.margin(1080)
slides, texts = [], []
for i in range(3):
    im = Image.new("RGB", (1080, 1350), bg)
    d = ImageDraw.Draw(im)
    words = "A home that follows the sun, part %d" % (i + 1)
    d.text((m, 900), words, font=kit.font("heading", 56), fill=ink)
    d.text((m, 1000), "Seven in the morning", font=font("Avenir Next", 40), fill=ink)
    slides.append(im)
    texts.append(words)
kit.place(slides[0], "tower.png", (0, 0, 1080, 700))
kit.place_logo(slides[-1], "bottom-right")
title = "Morning light"
"""


@unittest.skipUnless(HAVE_PIL, "the Artist's tools are not installed (run engine/art/install.sh); slide tests skipped")
class SlidesKitTest(unittest.TestCase):
    """The slide tool with a brand kit, installed as the engine installs it: state/art/tools/slides.py with
    kit.py and fontmap.json beside it, the kit in state/knowledge/docs/brand, the slides in a goal's folder."""

    def setUp(self):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from test_kit import a_kit, lay_out_state
        self.a_kit = a_kit
        self.root = tempfile.mkdtemp(prefix="uuu-slides-kit-test-")
        self.state = lay_out_state(self.root, a_kit())
        self.kit_file = os.path.join(self.state, "knowledge", "docs", "brand", "kit.json")
        tools = os.path.join(self.state, "art", "tools")
        os.makedirs(tools)
        for f in ("slides.py", "kit.py", "fontmap.json"):
            shutil.copy(os.path.join(ART, f), tools)
        self.tool = os.path.join(tools, "slides.py")
        self.work = os.path.join(self.state, "tasks", "company-work")
        self.dir = os.path.join(self.work, "STH-7", "slides", "launch")
        os.makedirs(self.dir)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def run_slides(self, text, tool=None, folder=None):
        folder = folder or self.dir
        with open(os.path.join(folder, "launch.py"), "w", encoding="utf-8") as fh:
            fh.write(text)
        return subprocess.run([sys.executable, tool or self.tool, "launch.py"], cwd=folder,
                              capture_output=True, text=True, timeout=120)

    def assertOneLine(self, r, *words):
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertEqual(r.stdout, "")
        lines = r.stderr.strip().splitlines()
        self.assertEqual(len(lines), 1, r.stderr)
        self.assertTrue(lines[0].startswith("slides: "), r.stderr)
        for w in words:
            self.assertIn(w, lines[0])
        self.assertEqual(sorted(os.listdir(self.dir)), ["launch.py"], "nothing is written on a problem")

    def test_a_script_on_the_kit_records_its_pictures_and_logo_and_passes_the_brand_check(self):
        r = self.run_slides(KIT_SCRIPT)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, "launch: 3 slides of 1080 × 1350. "
                                   "Wrote slide-01.png to slide-03.png, contact.png, slides.json.\n")
        with open(os.path.join(self.dir, "manifest.json"), encoding="utf-8") as fh:
            m = json.load(fh)
        self.assertEqual(m["pictures"], [{"slide": 1, "box": [0, 0, 1080, 700], "source": "tower.png"}])
        self.assertEqual(len(m["logo"]), 1)
        self.assertEqual((m["logo"][0]["file"], m["logo"][0]["slide"]), ("logo.png", 3))
        left, top, right, bottom = m["logo"][0]["box"]
        self.assertTrue(right <= 1080 and bottom <= 1350 and bottom - top >= 48, m["logo"])
        with Image.open(os.path.join(self.dir, "slide-01.png")) as im:
            self.assertEqual(im.convert("RGB").getpixel((5, 1300)), (0xE8, 0xDC, 0xC8))
        # T7's check, run as the Chief of staff runs it, from the task folder: it passes.
        r = subprocess.run([sys.executable, os.path.join(ART, "brandcheck.py"), "--json", "--state", self.state,
                            "STH-7"], cwd=self.work, capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        report = json.loads(r.stdout)
        self.assertEqual(report["kit"], "present")
        piece = [p for p in report["pieces"] if p["name"] == "launch"][0]
        self.assertEqual((piece["result"], piece["hard"], piece["soft"]), ("pass", [], []), piece)

    def test_a_typeface_outside_the_kit_is_one_line(self):
        r = self.run_slides(KIT_SCRIPT.replace('font("Avenir Next", 40)', 'font("Georgia", 40)'))
        self.assertOneLine(r, "line 10", "the brand kit's typefaces are Didot and Avenir Next", '"Georgia"')

    def test_type_below_the_kits_smallest_size_is_one_line(self):
        r = self.run_slides(KIT_SCRIPT.replace('font("Avenir Next", 40)', 'font("Avenir Next", 20)'))
        self.assertOneLine(r, "at least 28 px")

    def test_a_damaged_kit_stops_the_tool_with_one_line(self):
        with open(self.kit_file, "w") as fh:
            fh.write("{ not json")
        r = self.run_slides(KIT_SCRIPT)
        self.assertOneLine(r, "The brand kit (brand/kit.json) is damaged", "save the brand kit again")
        with open(self.kit_file, "w") as fh:
            json.dump(self.a_kit(colours=[{"name": "ink", "hex": "#1A3C5E", "role": "accent"},
                                          {"name": "sand", "hex": "#E8DCC8", "role": "background"}]), fh)
        self.assertOneLine(self.run_slides(KIT_SCRIPT), "exactly one main colour")

    def test_with_no_kit_the_script_gets_none_and_the_outputs_are_what_they_were(self):
        os.remove(self.kit_file)
        self.assertEqual(self.run_slides(carousel(2, extra="assert kit is None\n")).returncode, 0)
        old = tool_before_the_kit("slides.py")
        if old is None:
            self.skipTest("git cannot show the slide tool before the kit")
        before = os.path.join(self.root, "before")
        os.makedirs(os.path.join(before, "work"))
        with open(os.path.join(before, "slides.py"), "wb") as fh:
            fh.write(old)
        shutil.copy(FONTMAP, before)
        script = carousel(3, extra="sources = ['team-photo.jpg']\nf = font('Comic Nonesuch', 40)\n")
        r_old = self.run_slides(script, tool=os.path.join(before, "slides.py"), folder=os.path.join(before, "work"))
        r_new = self.run_slides(script)
        self.assertEqual(r_new.returncode, 0, r_new.stderr)
        self.assertEqual((r_new.stdout, r_new.stderr), (r_old.stdout, r_old.stderr))
        self.assertEqual(sorted(os.listdir(self.dir)), sorted(os.listdir(os.path.join(before, "work"))))
        for f in os.listdir(self.dir):
            with open(os.path.join(self.dir, f), "rb") as a, open(os.path.join(before, "work", f), "rb") as b:
                if f == "manifest.json":
                    ma, mb = json.loads(a.read()), json.loads(b.read())
                    ma.pop("made_at"), mb.pop("made_at")
                    self.assertEqual(ma, mb)
                else:
                    self.assertEqual(a.read(), b.read(), f)


if __name__ == "__main__":
    unittest.main()
