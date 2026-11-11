"""Tests for engine/art/sprite.py. Run with the Artist's own Python:

    ~/.paperclip/uuu-engine/art/venv/bin/python -m unittest discover -s engine/art/tests -p 'test_*.py'

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

SPRITE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sprite.py")

try:
    from PIL import Image
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False

# Four 16 x 16 frames, each a different flat colour with a dark square in it.
FOUR = """from PIL import Image, ImageDraw

colours = [(244, 162, 97, 255), (42, 157, 143, 255), (233, 196, 106, 255), (231, 111, 81, 255)]
frames = []
for i, c in enumerate(colours):
    im = Image.new("RGBA", (16, 16), c)
    ImageDraw.Draw(im).rectangle([i, 2, i + 11, 13], fill=(27, 27, 31, 255))
    frames.append(im)
durations = 120
tags = [{"name": "walk", "from": 0, "to": 3, "direction": "forward"}]
title = "Mascot walk cycle"
"""


@unittest.skipUnless(HAVE_PIL, "the Artist's tools are not installed (run engine/art/install.sh); sprite tests skipped")
class SpriteTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="uuu-art-test-")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_sprite(self, name, text, *extra):
        with open(os.path.join(self.dir, name), "w", encoding="utf-8") as fh:
            fh.write(text)
        return subprocess.run([sys.executable, SPRITE, name] + list(extra), cwd=self.dir,
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
        self.assertTrue(lines[0].startswith("sprite: "), r.stderr)
        self.assertEqual(self.files(), [script], "nothing is written on a problem")

    def test_four_frames_make_a_sheet_data_gif_and_manifest(self):
        r = self.run_sprite("walker.py", FOUR)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout,
                         "walker: 4 frames of 16 × 16, 1 tag, 5 colours. "
                         "Wrote walker-sheet.png, walker.json, walker.gif.\n")
        self.assertEqual(self.files(), ["manifest.json", "walker-sheet.png", "walker.gif",
                                        "walker.json", "walker.py"])
        with Image.open(os.path.join(self.dir, "walker-sheet.png")) as im:
            self.assertEqual(im.size, (64, 16))
            self.assertEqual(im.convert("RGBA").getpixel((16, 0)), (42, 157, 143, 255))
        data = self.read_json("walker.json")
        self.assertEqual(set(data), {"frames", "meta"})
        self.assertEqual(len(data["frames"]), 4)
        f1 = data["frames"][1]
        self.assertEqual(f1, {"filename": "walker 1.png", "frame": {"x": 16, "y": 0, "w": 16, "h": 16},
                              "rotated": False, "trimmed": False,
                              "spriteSourceSize": {"x": 0, "y": 0, "w": 16, "h": 16},
                              "sourceSize": {"w": 16, "h": 16}, "duration": 120})
        self.assertEqual(data["meta"], {"app": "uuu-engine", "version": "1", "image": "walker-sheet.png",
                                        "format": "RGBA8888", "size": {"w": 64, "h": 16}, "scale": "1",
                                        "frameTags": [{"name": "walk", "from": 0, "to": 3,
                                                       "direction": "forward"}]})
        with Image.open(os.path.join(self.dir, "walker.gif")) as im:
            self.assertEqual(im.n_frames, 4)
            self.assertEqual(im.info.get("duration"), 120)
        m = self.read_json("manifest.json")
        self.assertEqual(set(m), {"name", "title", "kind", "sheet", "data", "gif", "frames",
                                  "frameSize", "tags", "palette", "script", "made_at"})
        self.assertEqual(m["name"], "walker")
        self.assertEqual(m["title"], "Mascot walk cycle")
        self.assertEqual(m["kind"], "sprite")
        self.assertEqual((m["sheet"], m["data"], m["gif"], m["script"]),
                         ("walker-sheet.png", "walker.json", "walker.gif", "walker.py"))
        self.assertEqual(m["frames"], 4)
        self.assertEqual(m["frameSize"], {"w": 16, "h": 16})
        self.assertEqual(m["tags"], ["walk"])
        self.assertEqual(len(m["palette"]), 5)
        self.assertEqual(m["palette"][0], "#1b1b1f")   # the square is in every frame, so most used
        for c in m["palette"]:
            self.assertRegex(c, r"^#[0-9a-f]{6}$")
        self.assertRegex(m["made_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")

    def test_held_frames_stay_separate_in_the_gif(self):
        script = ("from PIL import Image\n"
                  "frames = [Image.new('RGBA', (8, 8), (10, 20, 30, 255)) for _ in range(3)]\n"
                  "durations = [100, 200, 300]\n")
        r = self.run_sprite("hold.py", script)
        self.assertEqual(r.returncode, 0, r.stderr)
        with Image.open(os.path.join(self.dir, "hold.gif")) as im:
            self.assertEqual(im.n_frames, 3)
            got = []
            for i in range(3):
                im.seek(i)
                got.append(im.info.get("duration"))
            self.assertEqual(got, [100, 200, 300])
        data = self.read_json("hold.json")
        self.assertEqual([f["duration"] for f in data["frames"]], [100, 200, 300])
        self.assertEqual(data["meta"]["frameTags"], [{"name": "all", "from": 0, "to": 2, "direction": "forward"}])
        self.assertIn("hold: 3 frames of 8 × 8, 1 tag, 1 colour.", r.stdout)

    def test_a_tag_past_the_last_frame_is_refused(self):
        r = self.run_sprite("walker.py", FOUR.replace('"to": 3', '"to": 4'))
        self.assertProblem(r, "walker.py")
        self.assertIn("from <= to < 4", r.stderr)

    def test_frames_of_two_sizes_are_refused(self):
        script = ("from PIL import Image\n"
                  "frames = [Image.new('RGBA', (16, 16)), Image.new('RGBA', (16, 8))]\n")
        r = self.run_sprite("mixed.py", script)
        self.assertProblem(r, "mixed.py")
        self.assertIn("same size", r.stderr)

    def test_two_columns_make_a_square_sheet(self):
        r = self.run_sprite("walker.py", FOUR + "columns = 2\n")
        self.assertEqual(r.returncode, 0, r.stderr)
        with Image.open(os.path.join(self.dir, "walker-sheet.png")) as im:
            self.assertEqual(im.size, (32, 32))
            self.assertEqual(im.convert("RGBA").getpixel((15, 31)), (233, 196, 106, 255))
        data = self.read_json("walker.json")
        self.assertEqual([f["frame"] for f in data["frames"]], [
            {"x": 0, "y": 0, "w": 16, "h": 16}, {"x": 16, "y": 0, "w": 16, "h": 16},
            {"x": 0, "y": 16, "w": 16, "h": 16}, {"x": 16, "y": 16, "w": 16, "h": 16}])
        self.assertEqual(data["meta"]["size"], {"w": 32, "h": 32})

    def test_frames_option_writes_one_png_per_frame(self):
        r = self.run_sprite("walker.py", FOUR, "--frames")
        self.assertEqual(r.returncode, 0, r.stderr)
        names = sorted(os.listdir(os.path.join(self.dir, "frames")))
        self.assertEqual(names, ["walker-00.png", "walker-01.png", "walker-02.png", "walker-03.png"])
        for n in names:
            with Image.open(os.path.join(self.dir, "frames", n)) as im:
                self.assertEqual(im.size, (16, 16))
        self.assertIn("frames/walker-00.png to frames/walker-03.png", r.stdout)

    def test_an_svg_string_makes_a_vector_image(self):
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
               '<defs><linearGradient id="g"><stop offset="0" stop-color="#f4a261"/></linearGradient></defs>'
               '<circle cx="16" cy="16" r="14" fill="#1b1b1f"/><use href="#g"/></svg>')
        r = self.run_sprite("badge.py", "svg = %r\ntitle = 'Round badge'\n" % svg)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.files(), ["badge.py", "badge.svg", "manifest.json"])
        with open(os.path.join(self.dir, "badge.svg"), encoding="utf-8") as fh:
            self.assertTrue(fh.read().startswith("<svg"))
        m = self.read_json("manifest.json")
        self.assertEqual(set(m), {"name", "title", "kind", "image", "script", "made_at"})
        self.assertEqual((m["name"], m["title"], m["kind"], m["image"], m["script"]),
                         ("badge", "Round badge", "image", "badge.svg", "badge.py"))
        self.assertTrue(r.stdout.startswith("badge: a vector image of "), r.stdout)
        self.assertTrue(r.stdout.endswith("Wrote badge.svg.\n"), r.stdout)

    def test_an_svg_with_a_script_is_refused(self):
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        r = self.run_sprite("bad.py", "svg = %r\n" % svg)
        self.assertProblem(r, "bad.py")
        self.assertIn("script", r.stderr)

    def test_an_svg_with_handlers_links_or_foreign_objects_is_refused(self):
        for svg in ['<svg onload="x()"></svg>',
                    '<svg><rect width="1" height="1" ONCLICK="x()"/></svg>',
                    '<svg><image href="http://example.com/a.png"/></svg>',
                    '<svg><a xlink:href="javascript:x()"><rect/></a></svg>',
                    '<svg><foreignObject><p>x</p></foreignObject></svg>',
                    '<?xml version="1.0"?><svg></svg>']:
            with self.subTest(svg=svg):
                r = self.run_sprite("bad.py", "svg = %r\n" % svg)
                self.assertProblem(r, "bad.py")

    def test_a_script_that_leaves_neither_is_refused(self):
        r = self.run_sprite("empty.py", "x = 1\n")
        self.assertProblem(r, "empty.py")
        self.assertIn("neither", r.stderr)

    def test_a_failing_script_is_one_line_with_its_line_number(self):
        r = self.run_sprite("broken.py", "print('hello')\nraise ValueError('no ink')\n")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout, "", "what the script prints goes to stderr, never into the plain line")
        self.assertEqual(r.stderr.strip().splitlines()[-1],
                         "sprite: the script failed on line 2: ValueError: no ink")
        self.assertEqual(self.files(), ["broken.py"])

    def test_bad_durations_and_names_are_refused(self):
        r = self.run_sprite("walker.py", FOUR + "durations = [100, 100, 5, 100]\n")
        self.assertProblem(r, "walker.py")
        os.remove(os.path.join(self.dir, "walker.py"))
        r = self.run_sprite("Walker_1.py", FOUR)
        self.assertProblem(r, "Walker_1.py")


if __name__ == "__main__":
    unittest.main()
