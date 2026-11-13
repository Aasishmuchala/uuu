"""Tests for the film commands of engine/art/video.py (PLAN-V5 T42): board, inputs, fit, clipstills and film.
Run with the Artist's own Python:

    ~/.paperclip/uuu-engine/art/venv/bin/python -m unittest discover -s engine/art/tests -p 'test_film.py'

Skipped, with a message, when Pillow or ffmpeg is not there. Each test lays out a state folder of its own in a
temporary folder, as the engine lays it out (state/art/tools/video.py beside kit.py and fontmap.json, the brand
folder, the room, state/tasks/company-work/STH-25) and runs the installed copy there with Python's -I; nothing
touches the engine's state. The renders, clips and sounds are made here with Pillow and ffmpeg.
"""
import json
import os
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ART)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import video  # noqa: E402

try:
    from PIL import Image, ImageDraw
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False

if HAVE_PIL:
    from test_kit import a_kit, lay_out_state, INK, SAND  # noqa: E402

FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
HAVE_FFMPEG = os.access(FFMPEG, os.X_OK) and os.access(FFPROBE, os.X_OK)


def tool_has_pillow():
    """True when the tool, run with -I as these tests run it, can import Pillow. A Python that finds Pillow only
    in the user's own site folder (which -I leaves out) is not the Artist's Python: the tests skip there."""
    try:
        return subprocess.run([sys.executable, "-I", "-c", "import PIL"], capture_output=True,
                              timeout=60).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


TOOL_PIL = HAVE_PIL and tool_has_pillow()
MAGENTA, BLUE, GREEN = (255, 0, 255), (20, 20, 200), (0, 200, 0)
NO_KIT_BAND, NO_KIT_INK = (12, 12, 16), (250, 250, 250)


def install(state):
    """video.py, kit.py and fontmap.json in <state>/art/tools, as engine/art/install.sh puts them."""
    tools = os.path.join(state, "art", "tools")
    os.makedirs(tools)
    for f in ("video.py", "kit.py", "fontmap.json"):
        shutil.copy(os.path.join(ART, f), os.path.join(tools, f))
    return os.path.join(tools, "video.py")


def a_shot(n, render="tower-dusk.png", kind="image_to_video", seconds=5, **over):
    shot = {"id": "s%02d" % n, "render": render, "seconds": seconds, "move": "Slow push toward the door",
            "prompt": "The camera moves slowly toward the entrance in the evening light.", "kind": kind}
    if render is None:
        del shot["render"]
    shot.update(over)
    return shot


def a_shotlist(shots, **over):
    doc = {"title": "A walk to the door", "seconds": 15, "ratio": "1280:720", "shots": shots}
    doc.update(over)
    return doc


def png_header(w, h):
    """A PNG that says it is w x h and holds almost nothing: decoding it would be the bomb."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00" * 64)) + chunk(b"IEND", b""))


@unittest.skipUnless(TOOL_PIL and HAVE_FFMPEG,
                     "Pillow (for this Python run with -I) or ffmpeg is not there (run engine/art/install.sh, and "
                     "run the tests with the Artist's Python); film tests skipped")
class FilmBase(unittest.TestCase):
    KIT = True

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="uuu-film-test-")
        self.state = lay_out_state(self.root, a_kit() if self.KIT else None)
        self.video = install(self.state)
        self.room = os.path.join(self.state, "media", "room")
        self.work = os.path.join(self.state, "tasks", "company-work")
        self.goal = os.path.join(self.work, "STH-25")
        self.treatment = os.path.join(self.goal, "film", "walk-a")
        os.makedirs(self.treatment)
        self.marker = os.path.join(self.root, "ffmpeg-started")
        self.fake = os.path.join(self.root, "fake-ffmpeg")
        with open(self.fake, "w") as fh:
            fh.write("#!/bin/sh\ntouch '%s'\nexit 1\n" % self.marker)
        os.chmod(self.fake, stat.S_IRWXU)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    # --- making things

    def render(self, name, size=(1600, 1000), colour=MAGENTA, folder=None):
        """A picture of two flat halves, the left in `colour`, saved in the room (or `folder`)."""
        im = Image.new("RGB", size, colour)
        ImageDraw.Draw(im).rectangle([size[0] // 2, 0, size[0] - 1, size[1] - 1], fill=BLUE)
        path = os.path.join(folder or self.room, name)
        im.save(path)
        return path

    def write_shotlist(self, doc, folder=None, name="shotlist.json"):
        with open(os.path.join(folder or self.treatment, name), "w", encoding="utf-8") as fh:
            json.dump(doc, fh)

    def make_clip(self, path, seconds=3, size="320x180", rate=24, src="testsrc"):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                        "-i", "%s=size=%s:rate=%d:duration=%s" % (src, size, rate, seconds),
                        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", path],
                       check=True, timeout=120)
        return path

    def make_sound(self, name, seconds=20):
        path = os.path.join(self.room, name)
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                        "-i", "sine=frequency=440:duration=%d" % seconds, "-c:a", "aac", path],
                       check=True, timeout=60)
        return path

    def edit_folder(self, name="walk"):
        d = os.path.join(self.goal, "video", name)
        os.makedirs(d, exist_ok=True)
        return d

    # --- running

    def env(self, ffmpeg=FFMPEG, tools=True):
        e = {k: v for k, v in os.environ.items() if not k.startswith("UUU_")}
        if tools:
            e.update(UUU_FFMPEG=ffmpeg, UUU_FFPROBE=FFPROBE)
        return e

    def run_tool(self, args, cwd=None, ffmpeg=FFMPEG, tools=True):
        return subprocess.run([sys.executable, "-I", self.video] + list(args), cwd=cwd or self.treatment,
                              env=self.env(ffmpeg, tools), capture_output=True, text=True, timeout=300)

    def brand_check(self):
        r = subprocess.run([sys.executable, "-I", os.path.join(ART, "brandcheck.py"), "--json", "--state", self.state,
                            "STH-25"], cwd=self.work, capture_output=True, text=True, timeout=120)
        return r.returncode, json.loads(r.stdout) if r.stdout else r.stderr

    def tree(self, folder=None):
        top = folder or self.treatment
        out = []
        for d, dirs, files in os.walk(top):
            for f in dirs + files:
                out.append(os.path.relpath(os.path.join(d, f), top))
        return sorted(out)

    def read_json(self, path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    def seconds(self, path, stream=None):
        args = [FFPROBE, "-v", "error"]
        if stream:
            args += ["-select_streams", stream, "-show_entries", "stream=duration"]
        else:
            args += ["-show_entries", "format=duration"]
        out = subprocess.run(args + ["-of", "default=nw=1:nk=1", path], capture_output=True, text=True,
                             check=True).stdout.split()
        return float(out[0]) if out else None

    def assertOk(self, r, start):
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(r.stdout.strip().splitlines()), 1, r.stdout)
        self.assertTrue(r.stdout.startswith(start), r.stdout)

    def assertRefused(self, r, words, before=None, folder=None, ffmpeg_started=False):
        """One `video:` line naming the problem, exit 1, nothing written, ffmpeg not started."""
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertEqual(r.stdout, "")
        lines = r.stderr.strip().splitlines()
        self.assertEqual(len(lines), 1, r.stderr)
        self.assertTrue(lines[0].startswith("video: "), r.stderr)
        self.assertIn(words, lines[0])
        if not ffmpeg_started:
            self.assertFalse(os.path.exists(self.marker), "ffmpeg was not started")
        if before is not None:
            self.assertEqual(self.tree(folder), before, "nothing is written on a problem")


class BoardTest(FilmBase):
    def three_renders(self):
        self.render("tower-dusk.png", colour=MAGENTA)
        self.render("garden.jpg", colour=GREEN)
        self.render("hall.png", size=(1000, 1600), colour=(230, 200, 0))

    def test_a_board_of_three_shots_writes_three_boards_and_a_manifest_the_brand_check_verifies(self):
        self.three_renders()
        self.write_shotlist(a_shotlist([a_shot(1), a_shot(2, "garden.jpg", best=True), a_shot(3, "hall.png")]))
        r = self.run_tool(["board", "shotlist.json"])
        self.assertOk(r, "board: 3 shots, wrote board/shot-01.png to shot-03.png.")
        self.assertEqual(self.tree(), ["board", "board/shot-01.png", "board/shot-02.png", "board/shot-03.png",
                                       "manifest.json", "shotlist.json"])
        band = int(round(720 * 0.14))
        box = [0, 0, 1280, 720 - band]
        self.assertEqual(self.read_json(os.path.join(self.treatment, "manifest.json")), {
            "kind": "board", "made_by": "board", "title": "A walk to the door", "ratio": "1280:720", "shots": 3,
            "pictures": [{"frame": "shot-01", "box": box, "source": "tower-dusk.png"},
                         {"frame": "shot-02", "box": box, "source": "garden.jpg"},
                         {"frame": "shot-03", "box": box, "source": "hall.png"}],
            "logo": []})
        with Image.open(os.path.join(self.treatment, "board", "shot-01.png")) as im:
            im = im.convert("RGB")
            self.assertEqual(im.size, (1280, 720))
            self.assertEqual(im.getpixel((5, 715)), SAND, "the band in the kit's background colour")
            self.assertEqual(im.getpixel((5, 5)), MAGENTA, "the render above the band")
            words = im.crop((0, 720 - band, 1280, 720)).getcolors(1280 * band)
            self.assertIn(INK, [c for _, c in words], "the words in the kit's main colour (it has no text colour)")
        code, report = self.brand_check()
        self.assertEqual(code, 0, report)
        piece = [p for p in report["pieces"] if p["kind"] == "film" and p["name"] == "walk-a"][0]
        self.assertEqual((piece["result"], piece["hard"], piece["soft"]), ("pass", [], []), piece)

    def test_renders_named_and_sized_as_the_owners_are_boarded_and_verified_by_the_brand_check(self):
        # PLAN-V5 T42b: names with spaces and brackets, a JPEG, and an 8K render of 56 million pixels and over 20 MB.
        self.render("Ridge House (dusk) 01.png", colour=MAGENTA)
        self.render("Ridge House (dusk) 02.jpg", colour=GREEN)
        big = Image.new("RGB", (8000, 7000), (230, 200, 0))
        ImageDraw.Draw(big).rectangle([4000, 0, 7999, 6999], fill=BLUE)
        big.paste(Image.frombytes("RGB", (8000, 1000), os.urandom(8000 * 1000 * 3)), (0, 0))   # the board crops it off
        big.save(os.path.join(self.room, "Ridge House (night) 8K.png"), compress_level=1)
        del big
        self.assertGreater(os.path.getsize(os.path.join(self.room, "Ridge House (night) 8K.png")), 20 * video.MB)
        self.write_shotlist(a_shotlist([a_shot(1, "Ridge House (dusk) 01.png"), a_shot(2, "Ridge House (dusk) 02.jpg"),
                                        a_shot(3, "Ridge House (night) 8K.png")]))
        self.assertOk(self.run_tool(["board", "shotlist.json"]), "board: 3 shots, wrote board/shot-01.png to shot-03.png.")
        code, report = self.brand_check()
        self.assertEqual(code, 0, report)
        piece = [p for p in report["pieces"] if p["kind"] == "film" and p["name"] == "walk-a"][0]
        self.assertEqual((piece["result"], piece["hard"], piece["soft"]), ("pass", [], []), piece)

    def test_with_no_kit_a_board_takes_todays_caption_type_and_colours(self):
        os.remove(os.path.join(self.state, "knowledge", "docs", "brand", "kit.json"))
        self.render("tower-dusk.png")
        self.write_shotlist(a_shotlist([a_shot(1)]))
        r = self.run_tool(["board", "shotlist.json"])
        self.assertOk(r, "board: 1 shot, wrote board/shot-01.png.")
        with Image.open(os.path.join(self.treatment, "board", "shot-01.png")) as im:
            im = im.convert("RGB")
            self.assertEqual(im.getpixel((2, 718)), NO_KIT_BAND)
            self.assertIn(NO_KIT_INK, [c for _, c in im.crop((0, 619, 1280, 720)).getcolors(1280 * 101)])

    def test_a_render_name_with_dot_dot_is_refused_and_nothing_is_written(self):
        self.render("tower-dusk.png")
        self.render("secret.png", folder=self.goal)
        for name in ("../secret.png", "../../secret.png", "/etc/hosts", ".hidden.png"):
            with self.subTest(name=name):
                self.write_shotlist(a_shotlist([a_shot(1), a_shot(2, name)]))
                before = self.tree()
                r = self.run_tool(["board", "shotlist.json"])
                self.assertRefused(r, "shot s02: `render` must be the bare name of a picture in the room", before)

    def test_a_missing_render_is_refused_naming_its_shot(self):
        self.render("tower-dusk.png")
        self.write_shotlist(a_shotlist([a_shot(1), a_shot(2), a_shot(3, "nowhere.png")]))
        before = self.tree()
        r = self.run_tool(["board", "shotlist.json"])
        self.assertRefused(r, 'shot s03: there is no render named "nowhere.png" in the room', before)

    def test_a_render_in_another_letter_case_or_a_link_in_the_room_is_not_taken(self):
        self.render("Tower-Dusk.png")
        self.write_shotlist(a_shotlist([a_shot(1, "tower-dusk.png")]))
        before = self.tree()
        self.assertRefused(self.run_tool(["board", "shotlist.json"]), "shot s01: there is no render named", before)
        outside = self.render("outside.png", folder=self.root)
        os.symlink(outside, os.path.join(self.room, "linked.png"))
        self.write_shotlist(a_shotlist([a_shot(1, "linked.png")]))
        before = self.tree()
        self.assertRefused(self.run_tool(["board", "shotlist.json"]), "is not a plain file", before)

    def test_a_13th_shot_is_refused_and_nothing_is_written(self):
        self.render("tower-dusk.png")
        self.write_shotlist(a_shotlist([a_shot(n, seconds=2) for n in range(1, 13)]
                                       + [dict(a_shot(12, seconds=2), id="s13")]))
        before = self.tree()
        self.assertRefused(self.run_tool(["board", "shotlist.json"]), "must hold 1 to 12 shots; it has 13", before)

    def test_a_shot_of_11_seconds_is_refused_and_nothing_is_written(self):
        self.render("tower-dusk.png")
        self.write_shotlist(a_shotlist([a_shot(1), a_shot(2, seconds=11)]))
        before = self.tree()
        self.assertRefused(self.run_tool(["board", "shotlist.json"]),
                           "shot s02: `seconds` must be a whole number from 2 to 10", before)

    def test_a_text_to_video_board_needs_no_render_and_no_tool(self):
        self.write_shotlist(a_shotlist([a_shot(1, None, "text_to_video"),
                                        a_shot(2, "not-in-the-room.png", "text_to_video", move="")]))
        r = self.run_tool(["board", "shotlist.json"], tools=False)
        self.assertOk(r, "board: 2 shots, wrote board/shot-01.png to shot-02.png.")
        m = self.read_json(os.path.join(self.treatment, "manifest.json"))
        self.assertEqual((m["pictures"], m["logo"], m["shots"]), ([], [], 2))
        with Image.open(os.path.join(self.treatment, "board", "shot-01.png")) as im:
            colours = [c for _, c in im.convert("RGB").getcolors(1280 * 720)]
            self.assertEqual(max(im.convert("RGB").getcolors(1280 * 720))[1], SAND, "the band colour whole")
            self.assertIn(INK, colours, "with its words")

    def test_a_tall_film_has_tall_boards_and_each_ratio_its_own_size(self):
        self.assertEqual([video.board_size(r) for r in video.VIDEO_RATIOS],
                         [(1280, 720), (720, 1280), (1280, 964), (964, 1280), (1280, 1280), (1280, 542)])
        self.render("tower-dusk.png")
        self.write_shotlist(a_shotlist([a_shot(1)], ratio="720:1280"))
        self.assertOk(self.run_tool(["board", "shotlist.json"]), "board: 1 shot")
        with Image.open(os.path.join(self.treatment, "board", "shot-01.png")) as im:
            self.assertEqual(im.size, (720, 1280))
        m = self.read_json(os.path.join(self.treatment, "manifest.json"))
        self.assertEqual(m["pictures"][0]["box"], [0, 0, 720, 1280 - 179])

    def test_a_rerun_with_fewer_shots_takes_away_the_boards_it_no_longer_has(self):
        self.render("tower-dusk.png")
        self.write_shotlist(a_shotlist([a_shot(n, seconds=3) for n in range(1, 5)]))
        self.assertOk(self.run_tool(["board", "shotlist.json"]), "board: 4 shots")
        self.write_shotlist(a_shotlist([a_shot(1), a_shot(2)]))
        self.assertOk(self.run_tool(["board", "shotlist.json"]), "board: 2 shots")
        self.assertEqual(sorted(os.listdir(os.path.join(self.treatment, "board"))), ["shot-01.png", "shot-02.png"])

    def test_a_board_folder_or_a_shotlist_that_is_a_link_or_too_big_is_refused(self):
        self.render("tower-dusk.png")
        self.write_shotlist(a_shotlist([a_shot(1)]))
        elsewhere = os.path.join(self.root, "elsewhere")
        os.makedirs(elsewhere)
        os.symlink(elsewhere, os.path.join(self.treatment, "board"))
        before = self.tree()
        self.assertRefused(self.run_tool(["board", "shotlist.json"]), "board is not a folder here", before)
        self.assertEqual(os.listdir(elsewhere), [])
        os.remove(os.path.join(self.treatment, "board"))
        self.write_shotlist(a_shotlist([a_shot(1)]), folder=self.root, name="real.json")
        os.symlink(os.path.join(self.root, "real.json"), os.path.join(self.treatment, "linked.json"))
        self.assertRefused(self.run_tool(["board", "linked.json"]), "is not a plain file", self.tree())
        self.write_shotlist(a_shotlist([a_shot(1)], padding="x" * 40000), name="big.json")
        self.assertRefused(self.run_tool(["board", "big.json"]), "larger than 32 KB", self.tree())

    def test_a_full_goal_refuses_a_board(self):
        self.render("tower-dusk.png")
        self.write_shotlist(a_shotlist([a_shot(1)]))
        with open(os.path.join(self.goal, "big.bin"), "wb") as fh:
            fh.truncate(2 * video.GB + video.MB)          # sparse: takes no disk
        before = self.tree()
        self.assertRefused(self.run_tool(["board", "shotlist.json"]), "at most 2 GB is allowed", before)


class ShotlistRulesTest(unittest.TestCase):
    """The shotlist's rules, the same list the home server's lib/shotlist.mjs reads (PLAN-V5 T41b)."""

    def refused(self, doc, words):
        with self.assertRaises(video.Problem) as cm:
            video.check_shotlist(doc)
        self.assertIn(words, str(cm.exception))

    def test_ids_run_s01_on_in_order_with_no_gap(self):
        self.refused(a_shotlist([dict(a_shot(1), id="s1")]), "shot 1's `id` must be s01")
        self.refused(a_shotlist([a_shot(2)]), "shot 1's `id` must be s01")
        self.refused(a_shotlist([a_shot(1), a_shot(3)]), "shot 2's `id` must be s02")
        self.refused(a_shotlist([]), "must hold 1 to 12 shots")
        self.assertEqual([s["id"] for s in video.check_shotlist(a_shotlist([a_shot(1), a_shot(2)]))["shots"]],
                         ["s01", "s02"])

    def test_titles_moves_and_prompts(self):
        self.refused(a_shotlist([a_shot(1)], title=""), "`title` must be 1 to 120 characters on one line")
        self.refused(a_shotlist([a_shot(1)], title="Two\nlines"), "`title`")
        self.refused(a_shotlist([a_shot(1)], title="A B"), "`title`")
        self.refused(a_shotlist([a_shot(1)], title="   "), "`title`")
        self.refused(a_shotlist([a_shot(1)], title="x" * 121), "`title`")
        self.refused(a_shotlist([a_shot(1, move="x" * 201)]), "shot s01: `move` must be one line")
        self.refused(a_shotlist([a_shot(1, move="a\tb")]), "shot s01: `move`")
        self.refused(a_shotlist([a_shot(1, prompt="x" * 1001)]), "shot s01: `prompt` must be 1 to 1000")
        self.refused(a_shotlist([a_shot(1, prompt="a\x07b")]), "shot s01: `prompt`")
        self.refused(a_shotlist([a_shot(1, prompt="a\r\nb")]), "shot s01: `prompt`")
        self.refused(a_shotlist([a_shot(1, prompt="  ")]), "shot s01: `prompt`")
        # Lengths as JavaScript counts them: an emoji is two.
        self.refused(a_shotlist([a_shot(1, prompt="\U0001F3E0" * 501)]), "shot s01: `prompt`")
        ok = video.check_shotlist(a_shotlist([a_shot(1, prompt="\U0001F3E0" * 500, move=""),
                                              a_shot(2, prompt="Line one\nline two")]))
        self.assertEqual(ok["shots"][1]["prompt"], "Line one\nline two")

    def test_numbers_kinds_renders_and_the_optional_fields(self):
        self.refused(a_shotlist([a_shot(1)], seconds=4), "`seconds` must be a whole number from 5 to 120")
        self.refused(a_shotlist([a_shot(1)], ratio="1920:1080"), "`ratio` must be one of 1280:720")
        self.refused(a_shotlist([a_shot(1, seconds=1)]), "shot s01: `seconds`")
        self.refused(a_shotlist([a_shot(1, seconds=5.5)]), "shot s01: `seconds`")
        self.refused(a_shotlist([a_shot(1, seconds=True)]), "shot s01: `seconds`")
        self.refused(a_shotlist([a_shot(1, kind="video_to_video")]), "shot s01: `kind`")
        self.refused(a_shotlist([dict((k, v) for k, v in a_shot(1).items() if k != "kind")]), "shot s01: `kind`")
        self.refused(a_shotlist([a_shot(1, None)]), "shot s01: `render`")
        self.refused(a_shotlist([a_shot(1, "x" * 101 + ".png")]), "shot s01: `render`")
        self.refused(a_shotlist([a_shot(1, "a/b.png", "text_to_video")]), "shot s01: `render`")
        self.refused(a_shotlist([a_shot(1, best="yes")]), "shot s01: `best`")
        self.refused(a_shotlist([a_shot(1)], cards={"title": "x" * 121}), "`cards`")
        self.refused(a_shotlist([a_shot(1)], cards="Title"), "`cards`")
        self.refused(a_shotlist([a_shot(1)], captions=["x"] * 25), "`captions`")
        self.refused(a_shotlist([a_shot(1)], captions=["two\nlines"]), "`captions`")
        ok = video.check_shotlist(a_shotlist(
            [a_shot(1, "Tower (dusk) 2.png", seconds=5.0), a_shot(2, None, "text_to_video", best=True)],
            seconds=30.0, cards={"title": "A walk", "end": None}, captions=["The door"], other={"ignored": True}))
        self.assertEqual((ok["seconds"], ok["shots"][0]["seconds"], ok["shots"][0]["best"], ok["shots"][1]["best"]),
                         (30, 5, False, True))
        self.assertIsNone(ok["shots"][1]["render"])

    def test_a_long_move_is_cut_with_an_ellipsis_to_fit(self):
        measure = len
        self.assertEqual(video.fit_line("s01 · 5 s · short", measure, 40), "s01 · 5 s · short")
        cut = video.fit_line("s01 · 5 s · " + "a long move " * 10, measure, 30)
        self.assertTrue(cut.endswith("…") and len(cut) <= 30, cut)


class InputsTest(FilmBase):
    def test_inputs_turns_a_6000_by_4000_png_into_a_1280_by_720_jpeg_of_at_most_3_2_mb(self):
        big = Image.linear_gradient("L").resize((6000, 4000)).convert("RGB")
        big.save(os.path.join(self.room, "big.png"))
        self.write_shotlist(a_shotlist([a_shot(1, "big.png"), a_shot(2, None, "text_to_video")]))
        r = self.run_tool(["inputs", "shotlist.json"])
        self.assertOk(r, "inputs: 1 picture, wrote inputs/s01.jpg.")
        self.assertEqual(os.listdir(os.path.join(self.treatment, "inputs")), ["s01.jpg"])
        path = os.path.join(self.treatment, "inputs", "s01.jpg")
        self.assertLessEqual(os.path.getsize(path), 3200000)
        with Image.open(path) as im:
            self.assertEqual((im.format, im.mode, im.size), ("JPEG", "RGB", (1280, 720)))

    def test_a_small_render_is_cropped_to_the_ratio_and_never_scaled_up(self):
        self.render("small.png", size=(800, 600))
        self.write_shotlist(a_shotlist([a_shot(1, "small.png")], ratio="1104:832"))
        self.assertOk(self.run_tool(["inputs", "shotlist.json"]), "inputs: 1 picture")
        with Image.open(os.path.join(self.treatment, "inputs", "s01.jpg")) as im:
            self.assertEqual(im.size, (796, 600))      # 1104:832 of 800 x 600, at its own size

    def test_a_render_over_80_megapixels_or_100_mb_is_refused_before_it_is_decoded(self):
        with open(os.path.join(self.room, "huge.png"), "wb") as fh:
            fh.write(png_header(10000, 9000))
        self.write_shotlist(a_shotlist([a_shot(1, "huge.png")]))
        before = self.tree()
        self.assertRefused(self.run_tool(["inputs", "shotlist.json"]), "larger than 80 million pixels", before)
        with open(os.path.join(self.room, "heavy.png"), "wb") as fh:
            fh.write(png_header(100, 100))
            fh.truncate(100 * video.MB + 1)              # sparse: takes no disk
        self.write_shotlist(a_shotlist([a_shot(1, "heavy.png")]))
        self.assertRefused(self.run_tool(["inputs", "shotlist.json"]), "larger than 100 MB", before)

    def test_the_jpeg_steps_go_down_until_the_picture_fits(self):
        noise = Image.frombytes("RGB", (640, 360), os.urandom(640 * 360 * 3))
        sizes = {}
        for q in (90, 60):
            buf = __import__("io").BytesIO()
            noise.save(buf, "JPEG", quality=q)
            sizes[q] = buf.tell()
        data = video.jpeg_under(noise, (sizes[90] + sizes[60]) // 2, "the picture")
        self.assertLess(len(data), sizes[90])
        self.assertLessEqual(len(data), (sizes[90] + sizes[60]) // 2)
        with self.assertRaises(video.Problem) as cm:
            video.jpeg_under(noise, sizes[60] - 1, "the picture")
        self.assertIn("quality 60", str(cm.exception))


class FitTest(FilmBase):
    def test_fit_long_2048_of_a_5000_px_picture_gives_2048(self):
        self.render("wide.png", size=(5000, 3000))
        r = self.run_tool(["fit", "wide.png", "wide", "--long", "2048"])
        self.assertOk(r, "fit: wrote inputs/wide.jpg, 2048 × 1229")
        path = os.path.join(self.treatment, "inputs", "wide.jpg")
        with Image.open(path) as im:
            self.assertEqual((im.format, im.size), ("JPEG", (2048, 1229)))
        self.assertLessEqual(os.path.getsize(path), 3200000)
        r = self.run_tool(["fit", "wide.png", "wide-default"])
        self.assertOk(r, "fit: wrote inputs/wide-default.jpg, 1920 × 1152")

    def test_long_200_and_a_short_side_under_300_are_refused(self):
        self.render("wide.png", size=(5000, 3000))
        before = self.tree()
        for args, words in ((["--long", "200"], "--long must be a whole number of pixels from 300 to 4096"),
                            (["--long", "5000"], "--long must be"),
                            (["--long", "2e3"], "--long must be"),
                            (["--ratio", "1680:720", "--long", "600"], "its short side must be at least 300 px"),
                            (["--ratio", "16:9"], "--ratio must be one of Runway's")):
            with self.subTest(args=args):
                self.assertRefused(self.run_tool(["fit", "wide.png", "wide"] + args), words, before)

    def test_fit_crops_to_a_ratio_never_scales_up_and_takes_the_company_pictures_from_a_stills_folder(self):
        still = os.path.join(self.goal, "stills", "tower")
        os.makedirs(still)
        r = self.run_tool(["fit", "tower.png", "tower", "--ratio", "1080:1920"], cwd=still)   # 800 x 600, in docs
        self.assertOk(r, "fit: wrote inputs/tower.jpg, 338 × 600")
        with Image.open(os.path.join(still, "inputs", "tower.jpg")) as im:
            self.assertEqual(im.size, (338, 600))

    def test_names_are_checked_and_a_picture_in_another_letter_case_is_not_found(self):
        self.render("Wide.png", size=(2000, 1000))
        before = self.tree()
        for args, words in ((["Wide.png", "Wide"], "the name for what is made may only use a to z"),
                            (["Wide.png", "../x"], "the name for what is made"),
                            (["../Wide.png", "x"], "the picture's bare name"),
                            (["Wide.gif", "x"], "the picture's bare name"),
                            (["wide.png", "x"], 'there is no picture named "wide.png"'),
                            (["Wide.png"], "give a picture and a name")):
            with self.subTest(args=args):
                self.assertRefused(self.run_tool(["fit"] + args), words, before)


class ClipStillsTest(FilmBase):
    def test_clipstills_writes_six_stills_at_most_640_wide(self):
        self.make_clip(os.path.join(self.treatment, "clips", "s01-t1.mp4"), seconds=3, size="1280x720", rate=25)
        r = self.run_tool(["clipstills", "s01-t1"])
        self.assertOk(r, "clipstills: 3.0 seconds of s01-t1.mp4, wrote clips/s01-t1/frame-01.png to frame-06.png.")
        frames = sorted(os.listdir(os.path.join(self.treatment, "clips", "s01-t1")))
        self.assertEqual(frames, ["frame-%02d.png" % i for i in range(1, 7)])
        for f in frames:
            with Image.open(os.path.join(self.treatment, "clips", "s01-t1", f)) as im:
                self.assertEqual((im.format, im.size), ("PNG", (640, 360)))

    def test_clipstills_refuses_a_link_a_bad_id_and_a_13_second_clip(self):
        outside = self.make_clip(os.path.join(self.root, "outside.mp4"), seconds=2)
        os.makedirs(os.path.join(self.treatment, "clips"))
        os.symlink(outside, os.path.join(self.treatment, "clips", "s01-t1.mp4"))
        before = self.tree()
        self.assertRefused(self.run_tool(["clipstills", "s01-t1"]), "is not a plain file", before)
        for cid in ("s01-t1/../x", "s13-t1", "s01-t6", "s1-t1", "../s01-t1"):
            with self.subTest(cid=cid):
                self.assertRefused(self.run_tool(["clipstills", cid]), "give one clip's id, such as s01-t1", before)
        self.make_clip(os.path.join(self.treatment, "clips", "s02-t1.mp4"), seconds=13, size="160x90", rate=10)
        before = self.tree()
        self.assertRefused(self.run_tool(["clipstills", "s02-t1"]), "a clip is at most 12 seconds", before)

    def test_clipstills_refuses_a_file_that_is_not_an_mp4_and_a_missing_clip(self):
        os.makedirs(os.path.join(self.treatment, "clips"))
        with open(os.path.join(self.treatment, "clips", "s01-t1.mp4"), "wb") as fh:
            fh.write(b"\x00" * 64)
        before = self.tree()
        self.assertRefused(self.run_tool(["clipstills", "s01-t1"]), "is not an MP4", before)
        self.assertRefused(self.run_tool(["clipstills", "s02-t2"]), "there is no clip clips/s02-t2.mp4", before)


class FilmTest(FilmBase):
    def clips(self, *specs):
        for cid, kw in specs:
            self.make_clip(os.path.join(self.treatment, "clips", cid + ".mp4"), **kw)

    def write_edit(self, spec, name="walk"):
        d = self.edit_folder(name)
        with open(os.path.join(d, name + ".json"), "w", encoding="utf-8") as fh:
            json.dump(spec, fh)
        return d

    def test_a_film_of_two_3_second_clips_with_captions_cards_and_a_room_sound(self):
        self.clips(("s01-t1", {"seconds": 3, "size": "640x360"}), ("s02-t1", {"seconds": 3, "size": "640x360",
                                                                              "src": "testsrc2"}))
        self.make_sound("music.m4a")
        d = self.write_edit({"film": "walk-a", "title": "A walk to the door",
                             "clips": [{"clip": "s01-t1", "caption": "The door at dusk"},
                                       {"clip": "s02-t1", "caption": "The garden wall"}],
                             "cards": {"title": {"text": "A walk to the door", "seconds": 2},
                                       "end": {"text": "Sthyra", "seconds": 1.5}},
                             "sound": "music.m4a"})
        r = self.run_tool(["film", "walk.json"], cwd=d)
        self.assertOk(r, "walk: 9.0 seconds of 640 × 360 at 24 frames a second")
        self.assertTrue(r.stdout.strip().endswith("; 2 clips from film/walk-a."), r.stdout)
        expected = 3 + 3 - 0.5 + 2 + 1.5
        self.assertAlmostEqual(self.seconds(os.path.join(d, "walk.mp4")), expected, delta=0.2)
        self.assertAlmostEqual(self.seconds(os.path.join(d, "walk.mp4"), "a:0"), expected, delta=0.2)
        self.assertEqual(sorted(os.listdir(d)), ["end-card.png", "manifest.json", "poster.png", "review",
                                                 "title-card.png", "walk.json", "walk.mp4"])
        with Image.open(os.path.join(d, "poster.png")) as im:
            self.assertEqual(im.size, (640, 360))
        stills = sorted(os.listdir(os.path.join(d, "review")))
        self.assertEqual(stills, ["frame-%02d.png" % i for i in range(1, 7)])
        for f in stills:
            with Image.open(os.path.join(d, "review", f)) as im:
                self.assertLessEqual(im.width, 640)
        m = self.read_json(os.path.join(d, "manifest.json"))
        self.assertEqual((m["made_by"], m["film"], m["kind"], m["video"], m["seconds"]),
                         ("film", "walk-a", "video", "walk.mp4", expected))
        self.assertEqual(m["clips"], [{"clip": "s01-t1", "from": 0.0, "to": 3.0},
                                      {"clip": "s02-t1", "from": 0.0, "to": 3.0}])
        self.assertEqual(sorted(e["frame"] for e in m["logo"]), ["end-card", "title-card"])
        self.assertEqual([f for f in os.listdir(d) if ".tmp" in f], [], "no temporary file is left behind")
        # The brand check: the cards are the kit's and pass; the poster is the film's footage and only warns.
        code, report = self.brand_check()
        piece = [p for p in report["pieces"] if p["kind"] == "video" and p["name"] == "walk"][0]
        self.assertEqual(piece["hard"], [], piece)
        self.assertTrue(all(e["where"] == "poster.png" for e in piece["soft"]), piece)

    def test_a_banned_phrase_in_a_film_caption_fails_the_brand_check_even_after_the_film_file_changes(self):
        # PLAN-V5 T42b: the edit records the captions it drew; the brand check reads them as it reads a reveal's.
        with open(os.path.join(self.state, "knowledge", "docs", "brand", "cant-say.md"), "w", encoding="utf-8") as fh:
            fh.write("# What we never say\n\n- best in town\n")
        self.clips(("s01-t1", {"seconds": 3}), ("s02-t1", {"seconds": 3, "src": "testsrc2"}))
        spec = {"film": "walk-a", "clips": [{"clip": "s01-t1", "caption": "The door at dusk"},
                                            {"clip": "s02-t1", "caption": "The best   in town"}]}
        d = self.write_edit(spec)
        self.assertOk(self.run_tool(["film", "walk.json"], cwd=d), "walk: 5.5 seconds")
        self.assertEqual(self.read_json(os.path.join(d, "manifest.json"))["captions"],
                         ["The door at dusk", "The best in town"])
        for changed in (False, True):
            if changed:    # the caption taken out of the film file afterwards: the film still shows it
                spec["clips"][1].pop("caption")
                self.write_edit(spec)
            code, report = self.brand_check()
            piece = [p for p in report["pieces"] if p["kind"] == "video" and p["name"] == "walk"][0]
            self.assertEqual((code, [(e["code"], e["where"]) for e in piece["hard"]]),
                             (1, [("banned_phrase", "captions")]), piece)

    def test_without_a_kit_pieces_are_trimmed_and_crossfaded_to_the_first_clips_size_and_rate(self):
        os.remove(os.path.join(self.state, "knowledge", "docs", "brand", "kit.json"))
        self.clips(("s01-t1", {"seconds": 3, "size": "320x180", "rate": 24}),
                   ("s02-t2", {"seconds": 4, "size": "640x480", "rate": 30, "src": "testsrc2"}))
        d = self.write_edit({"film": "walk-a",
                             "clips": [{"clip": "s01-t1", "from": 0.5, "to": 2.5}, {"clip": "s02-t2", "from": 1}]})
        r = self.run_tool(["film", "walk.json"], cwd=d)
        self.assertOk(r, "walk: 4.5 seconds of 320 × 180 at 24 frames a second")
        self.assertAlmostEqual(self.seconds(os.path.join(d, "walk.mp4")), 2 + 3 - 0.5, delta=0.2)
        self.assertIsNone(self.seconds(os.path.join(d, "walk.mp4"), "a:0"), "the clips' own sound is dropped")
        m = self.read_json(os.path.join(d, "manifest.json"))
        self.assertNotIn("pictures", m)
        self.assertEqual(m["clips"], [{"clip": "s01-t1", "from": 0.5, "to": 2.5},
                                      {"clip": "s02-t2", "from": 1.0, "to": 4.0}])

    def refuse(self, spec, words):
        d = self.write_edit(spec)
        before = self.tree(d)
        r = self.run_tool(["film", "walk.json"], cwd=d, ffmpeg=self.fake)
        self.assertRefused(r, words, before, folder=d)

    def test_a_film_naming_a_treatment_that_is_a_link_is_refused_before_ffmpeg_starts(self):
        other = os.path.join(self.root, "other-goal-film")
        self.make_clip(os.path.join(other, "clips", "s01-t1.mp4"), seconds=2)
        os.symlink(other, os.path.join(self.goal, "film", "walk-b"))
        self.refuse({"film": "walk-b", "clips": [{"clip": "s01-t1"}]}, "there is no treatment folder film/walk-b")
        self.refuse({"film": "../walk-a", "clips": [{"clip": "s01-t1"}]}, "`film` must be the name")

    def test_a_clip_id_with_a_slash_or_a_clip_that_is_a_link_is_refused_before_ffmpeg_starts(self):
        self.clips(("s01-t1", {"seconds": 2}))
        for cid in ("s01-t1/../s01-t1", "clips/s01-t1", "../walk-a/clips/s01-t1", "s01-t1.mp4"):
            with self.subTest(cid=cid):
                self.refuse({"film": "walk-a", "clips": [{"clip": cid}]}, "clip 1 must name a clip of the treatment")
        os.symlink(os.path.join(self.treatment, "clips", "s01-t1.mp4"),
                   os.path.join(self.treatment, "clips", "s02-t1.mp4"))
        self.refuse({"film": "walk-a", "clips": [{"clip": "s01-t1"}, {"clip": "s02-t1"}]}, "is not a plain file")

    def test_a_whole_over_120_seconds_is_refused_before_ffmpeg_starts(self):
        self.clips(("s01-t1", {"seconds": 12, "size": "160x90", "rate": 10}))
        self.refuse({"film": "walk-a", "clips": [{"clip": "s01-t1"}] * 11}, "at most 120 seconds is allowed")
        self.clips(("s02-t1", {"seconds": 11, "size": "160x90", "rate": 10}))
        self.refuse({"film": "walk-a", "clips": [{"clip": "s02-t1"}] * 11, "fade": 0},
                    "at most 120 seconds is allowed")

    def test_fades_pieces_and_keys_are_checked_before_ffmpeg_starts(self):
        self.clips(("s01-t1", {"seconds": 3}))
        two = [{"clip": "s01-t1"}, {"clip": "s01-t1", "from": 1, "to": 2}]
        for spec, words in (
                ({"film": "walk-a", "clips": two, "fade": 0.75}, "more than half the shortest piece"),
                ({"film": "walk-a", "clips": two, "fade": 1.5}, "`fade` must be from 0 to 1"),
                ({"film": "walk-a", "clips": [{"clip": "s01-t1", "from": 1, "to": 1.5}]}, "each piece is at least 1"),
                ({"film": "walk-a", "clips": [{"clip": "s01-t1", "to": 9}]}, "must lie inside its 3.0 seconds"),
                ({"film": "walk-a", "clips": [{"clip": "s01-t1"}], "shots": []}, "keys it does not have: shots"),
                ({"film": "walk-a", "clips": []}, "`clips` must be a list of 1 to 24"),
                ({"film": "walk-a", "clips": [{"clip": "s01-t1", "path": "x"}]}, "keys a clip does not have"),
                ({"film": "walk-a", "clips": [{"clip": "s09-t1"}]}, "there is no clip film/walk-a/clips/s09-t1.mp4")):
            with self.subTest(spec=spec):
                self.refuse(spec, words)

    def test_a_sound_must_be_a_bare_name_in_the_room_and_cards_need_the_kit(self):
        self.clips(("s01-t1", {"seconds": 2}))
        self.make_sound("music.m4a")
        self.make_sound("Loud.m4a")
        one = [{"clip": "s01-t1"}]
        self.refuse({"film": "walk-a", "clips": one, "sound": "../music.m4a"}, "`sound` must be the bare name")
        self.refuse({"film": "walk-a", "clips": one, "sound": "music.aac"}, "`sound` must be the bare name")
        self.refuse({"film": "walk-a", "clips": one, "sound": "loud.m4a"}, 'there is no sound named "loud.m4a"')
        os.remove(os.path.join(self.state, "knowledge", "docs", "brand", "kit.json"))
        self.refuse({"film": "walk-a", "clips": one, "cards": {"title": "Hi"}}, "there is no brand kit yet")


class PlaceTest(FilmBase):
    def test_board_from_a_video_folder_and_film_from_a_film_folder_get_the_folder_line(self):
        d = self.edit_folder("walk")
        self.render("tower-dusk.png")
        self.write_shotlist(a_shotlist([a_shot(1)]), folder=d)
        r = self.run_tool(["board", "shotlist.json"], cwd=d)
        self.assertRefused(r, "<goal>/film/<name>", ["shotlist.json"], folder=d)
        with open(os.path.join(self.treatment, "walk.json"), "w") as fh:
            json.dump({"film": "walk-a", "clips": [{"clip": "s01-t1"}]}, fh)
        r = self.run_tool(["film", "walk.json"], ffmpeg=self.fake)
        self.assertRefused(r, "<goal>/video/<name>", ["walk.json"])
        r = self.run_tool(["fit", "tower-dusk.png", "x"], cwd=d)
        self.assertRefused(r, "<goal>/film/<name> or <goal>/stills/<name>", ["shotlist.json"], folder=d)
        r = self.run_tool(["clipstills", "s01-t1"], cwd=os.path.join(self.goal))
        self.assertRefused(r, "<goal>/film/<name>")

    def test_where_each_command_runs(self):
        homes = ("/t/company-work", "/t/_proof")
        film, both = ("film",), ("film", "stills")
        self.assertEqual(video.goal_folder("/t/company-work/STH-1/film/walk-a", homes, film), "/t/company-work/STH-1")
        self.assertEqual(video.goal_folder("/t/_proof/art-check/film/fc-a", homes, film), "/t/_proof/art-check")
        self.assertEqual(video.goal_folder("/t/company-work/STH-1/stills/tower", homes, both), "/t/company-work/STH-1")
        for bad, places in (("/t/company-work/STH-1/video/walk", film), ("/t/company-work/STH-1/stills/a", film),
                            ("/t/company-work/STH-1/film/walk-a", ("video",)),
                            ("/t/company-work/STH-1/film/walk-a/clips", film),
                            ("/t/company-work/STH-1/film", film), ("/t/company-work/STH-1/film/Walk_A", both),
                            ("/t/company-work/STH-1/video/a", both)):
            with self.subTest(bad=bad, places=places):
                with self.assertRaises(video.Problem):
                    video.goal_folder(bad, homes, places)
        self.assertEqual(video.PLACES, {"board": film, "inputs": film, "clipstills": film, "fit": both})

    def test_the_all_goals_total_counts_the_film_and_stills_folders_too(self):
        home = os.path.join(self.root, "home", "company-work")
        for n, sub in enumerate(("film", "stills", "video", "film", "stills", "film"), 1):
            f = os.path.join(home, "STH-%d" % n, sub, "a")
            os.makedirs(f)
            with open(os.path.join(f, "a.bin"), "wb") as fh:
                fh.truncate(int(1.8 * video.GB))          # sparse: takes no disk
        fresh = os.path.join(home, "STH-99")
        os.makedirs(os.path.join(fresh, "film", "b"))
        with self.assertRaises(video.Problem) as cm:
            video.output_cap(fresh)
        self.assertIn("video, film and stills folders of all goals", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
