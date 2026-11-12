"""Tests for engine/art/kit.py. Run with the Artist's own Python:

    ~/.paperclip/uuu-engine/art/venv/bin/python -m unittest discover -s engine/art/tests -p 'test_kit.py'

Skipped, with a message, when Pillow is not installed (engine/art/install.sh).
Each test lays out a state folder of its own in a temporary folder; nothing
touches the engine's state.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ART)
import kit as kitmod  # noqa: E402

try:
    from PIL import Image, ImageDraw
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False

INK, SAND, CLAY = (0x1A, 0x3C, 0x5E), (0xE8, 0xDC, 0xC8), (0xC8, 0x55, 0x3D)


def a_kit(**over):
    kit = {
        "version": 1, "savedAt": "2026-11-12T10:00:00.000Z", "name": "Sthyra",
        "colours": [{"name": "ink", "hex": "#1A3C5E", "role": "main"},
                    {"name": "sand", "hex": "#E8DCC8", "role": "background"},
                    {"name": "clay", "hex": "#C8553D", "role": "accent"}],
        "neutrals": True,
        "type": {"heading": {"family": "Didot", "file": None, "fallback": "serif"},
                 "body": {"family": "Avenir Next", "file": None, "fallback": "sans-serif"},
                 "minPx": 16, "minSlidePx": 28},
        "logo": {"files": [{"file": "logo.png", "on": "light"}], "clearSpace": 0.5, "minPx": 48,
                 "requiredOn": ["carousel-last", "poster", "title-card", "end-card", "page"]},
        "layout": {"radiusPx": 0, "marginShare": 0.06},
        "voice": {"words": ["warm"], "is": "", "do": [], "dont": [], "signoff": ""},
        "references": [], "filler": {"block": True, "allow": []}, "public": {"summary": ""},
    }
    kit.update(over)
    return kit


def logo_picture(w=300, h=120):
    """A made-up logo: an ink bar and a clay dot on a transparent ground."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, h // 4, w * 2 // 3, h * 3 // 4], fill=INK + (255,))
    d.ellipse([w * 3 // 4, h // 4, w - 1, h * 3 // 4], fill=CLAY + (255,))
    return im


def lay_out_state(root, kit=None):
    """<root>/state with the brand folder, a logo, the room and one company picture."""
    state = os.path.join(root, "state")
    brand = os.path.join(state, "knowledge", "docs", "brand")
    os.makedirs(brand)
    os.makedirs(os.path.join(state, "knowledge", "docs", "pictures"))
    os.makedirs(os.path.join(state, "media", "room"))
    logo_picture().save(os.path.join(brand, "logo.png"))
    if kit is not None:
        with open(os.path.join(brand, "kit.json"), "w", encoding="utf-8") as fh:
            json.dump(kit, fh)
    tower = Image.new("RGB", (800, 600), (255, 0, 255))
    ImageDraw.Draw(tower).rectangle([400, 0, 799, 599], fill=(0, 200, 0))
    tower.save(os.path.join(state, "knowledge", "docs", "pictures", "tower.png"))
    Image.new("RGB", (400, 400), (10, 120, 250)).save(os.path.join(state, "media", "room", "site.jpg"))
    return state


@unittest.skipUnless(HAVE_PIL, "the Artist's tools are not installed (run engine/art/install.sh); kit tests skipped")
class KitTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="uuu-kit-test-")
        self.state = lay_out_state(self.root, a_kit())
        self.kit_file = os.path.join(self.state, "knowledge", "docs", "brand", "kit.json")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write_kit(self, kit):
        with open(self.kit_file, "w", encoding="utf-8") as fh:
            fh.write(kit if isinstance(kit, str) else json.dumps(kit))

    def assertOneSentence(self, cm, *words):
        msg = str(cm.exception)
        self.assertEqual(len(msg.splitlines()), 1, msg)
        self.assertTrue(msg.endswith("."), msg)
        for w in words:
            self.assertIn(w, msg)

    # --- finding and reading the kit

    def test_no_kit_file_gives_none(self):
        os.remove(self.kit_file)
        self.assertIsNone(kitmod.load_kit(self.state))

    def test_the_kit_gives_colours_palette_margin_and_families(self):
        kit = kitmod.load_kit(self.state)
        self.assertEqual(kit.colour("ink"), INK)
        self.assertEqual(kit.colour("sand"), SAND)
        self.assertEqual([c["name"] for c in kit.palette], ["ink", "sand", "clay"])
        self.assertEqual(kit.palette[0]["hex"], "#1A3C5E")
        self.assertEqual(kit.margin(1080), 65)
        self.assertEqual(kit.families, ["Didot", "Avenir Next"])

    def test_the_kit_is_found_from_where_the_tool_is_installed(self):
        tools = os.path.join(self.state, "art", "tools")
        os.makedirs(tools)
        shutil.copy(os.path.join(ART, "kit.py"), tools)
        import importlib.util
        spec = importlib.util.spec_from_file_location("kit_installed", os.path.join(tools, "kit.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertEqual(mod.STATE, os.path.realpath(self.state))
        self.assertEqual(mod.load_kit().colour("clay"), CLAY)

    def test_an_unknown_colour_is_one_plain_sentence(self):
        kit = kitmod.load_kit(self.state)
        with self.assertRaises(kitmod.KitProblem) as cm:
            kit.colour("teal")
        self.assertOneSentence(cm, '"teal"', "ink, sand, clay")

    def test_a_damaged_kit_is_one_plain_sentence(self):
        self.write_kit("{ not json")
        with self.assertRaises(kitmod.KitProblem) as cm:
            kitmod.load_kit(self.state)
        self.assertOneSentence(cm, "damaged")

    def test_each_broken_rule_names_its_field(self):
        cases = [
            (dict(colours=[{"name": "ink", "hex": "#1a3c5e", "role": "main"},
                           {"name": "sand", "hex": "#E8DCC8", "role": "background"}]), "colours[0].hex"),
            (dict(colours=[{"name": "ink", "hex": "#1A3C5E", "role": "main"},
                           {"name": "sand", "hex": "#E8DCC8", "role": "main"}]), "exactly one main"),
            (dict(colours=[{"name": "ink", "hex": "#1A3C5E", "role": "main"}]), "2 to 8"),
            (dict(type={"heading": {"family": "Didot"}, "body": {"family": "Avenir Next"},
                        "minPx": 16, "minSlidePx": 8}), "type.minSlidePx"),
            (dict(logo={"files": [{"file": "../logo.png", "on": "light"}]}), "logo.files[0].file"),
        ]
        for over, words in cases:
            self.write_kit(a_kit(**over))
            with self.assertRaises(kitmod.KitProblem) as cm:
                kitmod.load_kit(self.state)
            self.assertOneSentence(cm, words)

    def test_a_kit_that_is_a_link_or_too_large_is_refused(self):
        real = os.path.join(self.root, "elsewhere.json")
        with open(real, "w") as fh:
            json.dump(a_kit(), fh)
        os.remove(self.kit_file)
        os.symlink(real, self.kit_file)
        with self.assertRaises(kitmod.KitProblem) as cm:
            kitmod.load_kit(self.state)
        self.assertOneSentence(cm, "not a plain file")
        os.remove(self.kit_file)
        self.write_kit(json.dumps(a_kit()) + " " * (300 * 1024))
        with self.assertRaises(kitmod.KitProblem):
            kitmod.load_kit(self.state)

    def test_a_kit_that_is_a_pipe_is_refused_without_waiting(self):
        os.remove(self.kit_file)
        os.mkfifo(self.kit_file)
        with self.assertRaises(kitmod.KitProblem):
            kitmod.load_kit(self.state)

    # --- type

    def test_font_below_the_minimum_is_refused_naming_the_minimum(self):
        kit = kitmod.load_kit(self.state)
        with self.assertRaises(kitmod.KitProblem) as cm:
            kit.font("body", 20)
        self.assertOneSentence(cm, "at least 28 px", "20 px")
        with self.assertRaises(kitmod.KitProblem):
            kit.font("caption", 40)

    def test_font_at_the_minimum_is_the_kits_face(self):
        kit = kitmod.load_kit(self.state)
        if not os.path.exists("/System/Library/Fonts/Supplemental/Didot.ttc"):
            self.skipTest("Didot is not on this Mac")
        f = kit.font("heading", 28)
        self.assertEqual(f.size, 28)
        self.assertEqual(f.getname()[0], "Didot")

    # --- the logo and pictures

    def test_the_logo_is_never_upscaled_past_its_file(self):
        kit = kitmod.load_kit(self.state)
        self.assertEqual(kit.logo(height=60).size, (150, 60))
        self.assertEqual(kit.logo(height=500).size, (300, 120))
        self.assertEqual(kit.logo().mode, "RGBA")

    def test_place_cover_fits_a_company_picture_and_records_it(self):
        kit = kitmod.load_kit(self.state)
        im = Image.new("RGB", (1080, 1350), SAND)
        box = kit.place(im, "tower.png", (100, 100, 500, 400))
        self.assertEqual(box, [100, 100, 500, 400])
        self.assertEqual(im.getpixel((110, 250)), (255, 0, 255))     # the left half of the tower
        self.assertEqual(im.getpixel((490, 250)), (0, 200, 0))
        self.assertEqual(im.getpixel((50, 50)), SAND)
        other = Image.new("RGB", (1080, 1350), SAND)
        kit.place(other, "site.jpg", (0, 0, 200, 200))                  # from the room
        rec = kit.recorded([other, im])
        self.assertEqual(rec["pictures"], [{"slide": 1, "box": [0, 0, 200, 200], "source": "site.jpg"},
                                           {"slide": 2, "box": [100, 100, 500, 400], "source": "tower.png"}])

    def test_place_takes_only_a_bare_name_it_can_find(self):
        kit = kitmod.load_kit(self.state)
        im = Image.new("RGB", (1080, 1350), SAND)
        for name in ("../pictures/tower.png", "/etc/hosts.png", "nothere.png", "tower.gif"):
            with self.assertRaises(kitmod.KitProblem) as cm:
                kit.place(im, name, (0, 0, 10, 10))
            self.assertOneSentence(cm)
        with self.assertRaises(kitmod.KitProblem):
            kit.place(im, "tower.png", (0, 0, 2000, 10))
        self.assertEqual(kit.recorded([im]), {"pictures": [], "logo": []})

    def test_place_logo_in_a_corner_keeps_the_clear_space_and_records_it(self):
        kit = kitmod.load_kit(self.state)
        im = Image.new("RGB", (1080, 1350), SAND)
        l, t, r, b = kit.place_logo(im, "bottom-right")
        h = b - t
        self.assertGreaterEqual(h, 48)
        self.assertGreaterEqual(min(l, t, 1080 - r, 1350 - b), 0.5 * h)
        rec = kit.recorded([im], key="frame", labels=["end-card"])
        self.assertEqual(rec["logo"], [{"file": "logo.png", "frame": "end-card", "box": [l, t, r, b]}])
        self.assertEqual(im.getpixel((l + 2, (t + b) // 2)), INK)

    def test_place_logo_too_close_to_the_edge_or_too_small_is_refused(self):
        kit = kitmod.load_kit(self.state)
        im = Image.new("RGB", (1080, 1350), SAND)
        with self.assertRaises(kitmod.KitProblem) as cm:
            kit.place_logo(im, (0, 0, 300, 120))
        self.assertOneSentence(cm, "clear space")
        with self.assertRaises(kitmod.KitProblem) as cm:
            kit.place_logo(im, (500, 500, 560, 524))
        self.assertOneSentence(cm, "at least 48 px")
        with self.assertRaises(kitmod.KitProblem):
            kit.place_logo(im, "middle")
        self.assertEqual(kit.recorded([im])["logo"], [])


if __name__ == "__main__":
    unittest.main()
