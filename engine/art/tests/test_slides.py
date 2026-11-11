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


if __name__ == "__main__":
    unittest.main()
