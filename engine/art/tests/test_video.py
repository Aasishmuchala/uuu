"""Tests for engine/art/video.py. Run with the Artist's own Python:

    ~/.paperclip/uuu-engine/art/venv/bin/python -m unittest discover -s engine/art/tests -p 'test_video.py'

Skipped, with a message, when Pillow or ffmpeg is not there. The scripts here
are our own, so running them outside the fence is fine. Each test works in a
temporary <goal>/video/<name> folder; nothing touches the engine's state.
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEO = os.path.join(ART, "video.py")
sys.path.insert(0, ART)
import video  # noqa: E402

try:
    from PIL import Image
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False

FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
HAVE_FFMPEG = os.access(FFMPEG, os.X_OK) and os.access(FFPROBE, os.X_OK)

TWO_SECONDS = """from PIL import Image, ImageDraw

size = (320, 180)
fps = 12
title = "Opening title"

def frames_():
    for i in range(24):
        im = Image.new("RGB", size, (20, 24, 40))
        ImageDraw.Draw(im).ellipse([10 + i * 10, 60, 70 + i * 10, 120], fill=(240, 160, 60))
        yield im

frames = frames_()
"""


def install_copy(state):
    """Copies video.py and fontmap.json into <state>/art/tools, as engine/art/install.sh does."""
    tools = os.path.join(state, "art", "tools")
    os.makedirs(tools)
    for f in ("video.py", "fontmap.json"):
        shutil.copy(os.path.join(ART, f), os.path.join(tools, f))
    return os.path.join(tools, "video.py")


def script(size="(64, 64)", fps="10", count="20", frames=True):
    text = "from PIL import Image\n\nsize = %s\nfps = %s\n" % (size, fps)
    if frames:
        text += "frames = [Image.new('RGB', size, (i * 10 %% 255, 40, 80)) for i in range(%s)]\n" % count
    return text


@unittest.skipUnless(HAVE_PIL and HAVE_FFMPEG,
                     "Pillow or ffmpeg is not there (run engine/art/install.sh); video tests skipped")
class VideoTest(unittest.TestCase):
    def setUp(self):
        # The helper trusts only the folders found from where it is installed, so it is run from a copy laid
        # out as the engine lays it out: state/art/tools/video.py and state/tasks/company-work/<goal>.
        self.root = tempfile.mkdtemp(prefix="uuu-video-test-")
        self.video = install_copy(os.path.join(self.root, "state"))
        self.goal = os.path.join(self.root, "state", "tasks", "company-work", "STH-25")
        self.dir = os.path.join(self.goal, "video", "clip")
        os.makedirs(self.dir)
        self.fake = os.path.join(self.root, "fake-ffmpeg")
        self.marker = os.path.join(self.root, "ffmpeg-started")
        with open(self.fake, "w") as fh:
            fh.write("#!/bin/sh\ntouch '%s'\nexit 1\n" % self.marker)
        os.chmod(self.fake, stat.S_IRWXU)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def env(self, ffmpeg=FFMPEG):
        e = {k: v for k, v in os.environ.items() if not k.startswith("UUU_")}
        e.update(UUU_FFMPEG=ffmpeg, UUU_FFPROBE=FFPROBE)
        return e

    def write(self, name, text, folder=None):
        with open(os.path.join(folder or self.dir, name), "w", encoding="utf-8") as fh:
            fh.write(text)

    def run_video(self, *args, env=None):
        return subprocess.run([sys.executable, self.video] + list(args), cwd=self.dir, env=env or self.env(),
                              capture_output=True, text=True, timeout=300)

    def read_json(self, name):
        with open(os.path.join(self.dir, name), encoding="utf-8") as fh:
            return json.load(fh)

    def duration(self, name):
        out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of",
                              "default=nw=1:nk=1", os.path.join(self.dir, name)],
                             capture_output=True, text=True, check=True).stdout
        return float(out)

    def assertMade(self, r, name, w, h, made_by):
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(r.stdout.strip().splitlines()), 1, r.stdout)
        self.assertTrue(r.stdout.startswith(name + ": "), r.stdout)
        m = self.read_json("manifest.json")
        self.assertEqual(set(m), {"name", "title", "kind", "video", "poster", "width", "height", "fps",
                                  "seconds", "bytes", "made_by", "script", "made_at"})
        self.assertEqual((m["name"], m["kind"], m["video"], m["poster"], m["made_by"]),
                         (name, "video", name + ".mp4", "poster.png", made_by))
        self.assertEqual((m["width"], m["height"]), (w, h))
        with open(os.path.join(self.dir, m["video"]), "rb") as fh:
            self.assertEqual(fh.read(8)[4:8], b"ftyp")
        self.assertEqual(m["bytes"], os.path.getsize(os.path.join(self.dir, m["video"])))
        with Image.open(os.path.join(self.dir, "poster.png")) as im:
            self.assertEqual(im.size, (w, h))
        stills = sorted(os.listdir(os.path.join(self.dir, "review")))
        self.assertEqual(stills, ["frame-%02d.png" % i for i in range(1, 7)])
        for f in stills:
            with Image.open(os.path.join(self.dir, "review", f)) as im:
                self.assertLessEqual(im.width, 640)
        left = [f for f in os.listdir(self.dir) if ".tmp" in f]
        self.assertEqual(left, [], "no temporary file is left behind")
        return m

    def assertRefused(self, r, before, words):
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertEqual(r.stdout, "")
        lines = r.stderr.strip().splitlines()
        self.assertEqual(len(lines), 1, r.stderr)
        self.assertTrue(lines[0].startswith("video: "), r.stderr)
        self.assertIn(words, lines[0])
        self.assertFalse(os.path.exists(self.marker), "ffmpeg was not started")
        self.assertEqual(sorted(os.listdir(self.dir)), before, "nothing is written on a problem")

    # --- render ---------------------------------------------------------------

    def test_a_two_second_render_writes_the_video_poster_six_stills_and_manifest(self):
        self.write("clip.py", TWO_SECONDS)
        r = self.run_video("render", "clip.py")
        m = self.assertMade(r, "clip", 320, 180, "render")
        self.assertEqual((m["fps"], m["seconds"], m["title"], m["script"]), (12, 2, "Opening title", "clip.py"))
        self.assertAlmostEqual(self.duration("clip.mp4"), 2.0, delta=0.15)
        self.assertEqual(sorted(os.listdir(self.dir)),
                         ["clip.mp4", "clip.py", "manifest.json", "poster.png", "review"])
        # stills alone, again
        shutil.rmtree(os.path.join(self.dir, "review"))
        r = self.run_video("stills", "clip.mp4")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(os.listdir(os.path.join(self.dir, "review"))), 6)

    def refuse(self, text, words):
        self.write("clip.py", text)
        r = self.run_video("render", "clip.py", env=self.env(self.fake))
        self.assertRefused(r, ["clip.py"], words)

    def test_1921_pixels_wide_is_refused_before_ffmpeg(self):
        self.refuse(script(size="(1921, 1080)"), "1921 × 1080")

    def test_31_frames_a_second_is_refused_before_ffmpeg(self):
        self.refuse(script(fps="31"), "from 1 to 30")

    def test_121_seconds_is_refused_before_ffmpeg(self):
        self.refuse(script(size="(16, 16)", fps="1", count="121"), "at most 120 seconds")

    def test_an_odd_height_is_refused_before_ffmpeg(self):
        self.refuse(script(size="(64, 63)"), "odd side")

    def test_a_missing_frames_is_refused_before_ffmpeg(self):
        self.refuse(script(frames=False), "no `frames`")

    def test_a_frame_of_the_wrong_size_is_refused_before_ffmpeg(self):
        self.refuse("from PIL import Image\nsize = (64, 64)\nfps = 10\nframes = [Image.new('RGB', (32, 32))]\n",
                    "frame 0 is 32 × 32")

    def test_a_missing_tool_variable_is_refused(self):
        self.write("clip.py", TWO_SECONDS)
        e = self.env()
        del e["UUU_FFMPEG"]
        r = self.run_video("render", "clip.py", env=e)
        self.assertRefused(r, ["clip.py"], "UUU_FFMPEG is not set")

    def test_the_scripts_own_error_is_one_line(self):
        self.refuse("x = 1\nraise ValueError('no luck')\n", "line 2: ValueError: no luck")

    # --- reveal ---------------------------------------------------------------

    def test_a_reveal_of_two_pictures(self):
        pics = os.path.join(self.goal, "pictures")
        os.makedirs(pics)
        Image.new("RGB", (800, 600), (200, 80, 40)).save(os.path.join(pics, "front.png"))
        Image.new("RGB", (600, 800), (40, 120, 200)).save(os.path.join(pics, "garden.jpg"))
        self.write("tour.json", json.dumps({
            "size": [320, 180], "fps": 10, "title": "The house",
            "shots": [
                {"image": "../../pictures/front.png", "seconds": 1.5, "move": "in", "caption": "The front door"},
                {"image": "../../pictures/garden.jpg", "seconds": 1.5, "move": "left"},
            ]}))
        r = self.run_video("reveal", "tour.json")
        m = self.assertMade(r, "tour", 320, 180, "reveal")
        self.assertEqual((m["fps"], m["title"]), (10, "The house"))
        self.assertAlmostEqual(self.duration("tour.mp4"), 2.5, delta=0.2)   # 1.5 + 1.5 - a 0.5 crossfade
        self.assertEqual(m["seconds"], round(self.duration("tour.mp4"), 1), "the length has one decimal")

    def test_a_reveal_cannot_reach_outside_the_goals_folder(self):
        outside = os.path.join(self.root, "secret.png")
        Image.new("RGB", (40, 40)).save(outside)
        self.write("tour.json", json.dumps({"size": [64, 64], "fps": 10,
                                            "shots": [{"image": outside, "seconds": 1}]}))
        r = self.run_video("reveal", "tour.json", env=self.env(self.fake))
        self.assertRefused(r, ["tour.json"], "no picture named")

    # --- cut ------------------------------------------------------------------

    def make_source(self):
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
                        "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=4",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                        "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-shortest",
                        os.path.join(self.goal, "talk.mp4")], check=True, timeout=60)

    def test_a_cut_inside_a_word_is_moved_to_the_words_edge(self):
        words = [{"w": "hello", "from": 0.2, "to": 0.6}, {"w": "there", "from": 1.0, "to": 1.6},
                 {"w": "friend", "from": 2.4, "to": 2.9}]
        self.assertEqual(video.snap_ranges([(0.0, 1.3), (2.6, 3.0)], words, 4.0), [[0.0, 1.6], [2.4, 3.0]])
        self.assertEqual(video.snap_ranges([(0.0, 0.8), (0.7, 1.2)], words, 4.0), [[0.0, 1.6]])

        self.make_source()
        self.write("words.json", json.dumps(words))
        self.write("short.json", json.dumps({"source": "../../talk.mp4", "keep": [[0, 1.3], [2.0, 3.0]],
                                             "captions": "words.json"}))
        r = self.run_video("cut", "short.json")
        m = self.assertMade(r, "short", 320, 240, "cut")
        self.assertIn("kept 2 parts", r.stdout)
        # 0 to 1.3 ends inside "there" (1.0 to 1.6), so it keeps to 1.6: 1.6 + 1.0 seconds
        self.assertAlmostEqual(self.duration("short.mp4"), 2.6, delta=0.15)
        self.assertEqual(m["seconds"], round(self.duration("short.mp4"), 1), "one decimal, not rounded to 3")
        self.assertIsInstance(m["seconds"], float)

    def test_a_keep_after_the_clips_end_is_refused(self):
        self.make_source()
        self.write("short.json", json.dumps({"source": "../../talk.mp4", "keep": [[5, 6]], "captions": None}))
        r = self.run_video("cut", "short.json", env=self.env())
        self.assertEqual(r.returncode, 1)
        self.assertIn("starts after the clip ends", r.stderr)

    # --- words ----------------------------------------------------------------

    def test_words_are_read_from_the_speech_tools_output(self):
        self.make_source()
        stt = os.path.join(self.root, "fake-stt")
        with open(stt, "w") as fh:
            fh.write("""#!/bin/sh
while [ $# -gt 0 ]; do [ "$1" = "-of" ] && out="$2"; shift; done
cat > "$out.json" <<'J'
{"transcription": [
 {"offsets": {"from": 0, "to": 320}, "text": " [BLANK_AUDIO]"},
 {"offsets": {"from": 320, "to": 610}, "text": " hello"},
 {"offsets": {"from": 700, "to": 1010}, "text": " there"}]}
J
""")
        os.chmod(stt, stat.S_IRWXU)
        model = os.path.join(self.root, "model.bin")
        open(model, "wb").close()
        e = self.env()
        e.update(UUU_STT=stt, UUU_STT_MODEL=model)
        r = self.run_video("words", "../../talk.mp4", env=e)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.read_json("words.json"),
                         [{"w": "hello", "from": 0.32, "to": 0.61}, {"w": "there", "from": 0.7, "to": 1.01}])
        self.assertEqual(sorted(os.listdir(self.dir)), ["words.json"])
        self.assertNotIn("speech starts", r.stdout, "the tone starts at once: nothing to move")
        del e["UUU_STT_MODEL"]
        r = self.run_video("words", "../../talk.mp4", env=e)
        self.assertEqual(r.returncode, 1)
        self.assertIn("UUU_STT_MODEL is not set", r.stderr)

    def fake_stt(self, words):
        stt = os.path.join(self.root, "fake-stt")
        segs = ",".join('{"offsets": {"from": %d, "to": %d}, "text": " %s"}' % (a * 1000, b * 1000, w) for w, a, b in words)
        with open(stt, "w") as fh:
            fh.write('#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "-of" ] && out="$2"; shift; done\n'
                     'cat > "$out.json" <<\'J\'\n{"transcription": [%s]}\nJ\n' % segs)
        os.chmod(stt, stat.S_IRWXU)
        model = os.path.join(self.root, "model.bin")
        open(model, "wb").close()
        return stt, model

    def test_no_word_is_timed_before_speech_starts(self):
        # 1.2 seconds of silence, then the voice (a tone); the speech tool spreads the first words from 0.
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
                        "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=25:duration=4",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=2.8,adelay=1200",
                        "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-t", "4",
                        os.path.join(self.goal, "late.mp4")], check=True, timeout=60)
        stt, model = self.fake_stt([("hello", 0.0, 0.4), ("there", 0.4, 1.5), ("friend", 1.6, 2.0)])
        e = self.env()
        e.update(UUU_STT=stt, UUU_STT_MODEL=model)
        r = self.run_video("words", "../../late.mp4", env=e)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("speech starts at 1.2 seconds", r.stdout)
        words = self.read_json("words.json")
        self.assertEqual([w["w"] for w in words], ["hello", "there", "friend"])
        self.assertGreaterEqual(words[0]["from"], 1.1)
        for a, b in zip(words, words[1:]):
            self.assertLessEqual(a["from"], a["to"])
            self.assertLessEqual(a["to"], b["from"] + 1e-9)
        self.assertEqual(words[2], {"w": "friend", "from": 1.6, "to": 2.0})

        # When the silence cannot be found, today's times stay, and the one line says so.
        wrap = os.path.join(self.root, "ffmpeg-no-silence")
        with open(wrap, "w") as fh:
            fh.write('#!/bin/sh\ncase "$*" in *silencedetect*) exit 1;; esac\nexec %s "$@"\n' % FFMPEG)
        os.chmod(wrap, stat.S_IRWXU)
        e.update(UUU_FFMPEG=wrap)
        r = self.run_video("words", "../../late.mp4", env=e)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(r.stdout.strip().splitlines()), 1)
        self.assertIn("where speech starts could not be found", r.stdout)
        self.assertEqual(self.read_json("words.json")[0], {"w": "hello", "from": 0.0, "to": 0.4})
        self.assertEqual(sorted(os.listdir(self.dir)), ["words.json"], "nothing else is left behind")


# The trial's own words (.router/evidence/M61/captions/words.json): 52 words, five sentences, 17 seconds.
TRIAL_WORDS = [{"w": w, "from": a, "to": b} for w, a, b in [
    ("This", 0.0, 0.57), ("is", 0.57, 0.85), ("a", 0.85, 0.99), ("trial", 0.99, 2.01), ("clip", 2.01, 2.27),
    ("for", 2.27, 2.69), ("the", 2.69, 3.18), ("studio.", 3.18, 4.28), ("We", 4.28, 4.42), ("are", 4.42, 4.62),
    ("testing", 4.62, 5.13), ("captions", 5.13, 5.7), ("today.", 5.7, 6.29), ("The", 6.29, 6.32),
    ("workshop", 6.32, 6.9), ("opens", 6.9, 7.28), ("at", 7.28, 7.36), ("nine", 7.36, 7.6), ("in", 7.6, 7.68),
    ("the", 7.68, 7.8), ("morning", 7.8, 8.0), ("and", 8.0, 8.23), ("closes", 8.23, 8.71), ("at", 8.71, 8.85),
    ("six", 8.85, 9.07), ("in", 9.07, 9.27), ("the", 9.27, 9.45), ("evening.", 9.45, 10.0), ("Every", 10.0, 10.35),
    ("order", 10.35, 10.7), ("is", 10.7, 10.84), ("packed", 10.84, 11.26), ("by", 11.26, 11.4), ("hand", 11.4, 11.89),
    ("and", 11.89, 12.01), ("checked", 12.01, 12.38), ("twice", 12.38, 12.73), ("before", 12.73, 13.18),
    ("it", 13.18, 13.3), ("leaves.", 13.3, 14.25), ("Thank", 14.25, 14.3), ("you", 14.3, 14.48), ("for", 14.48, 14.66),
    ("watching", 14.66, 15.14), ("this", 15.14, 15.38), ("short", 15.38, 15.68), ("test,", 15.68, 16.22),
    ("and", 16.22, 16.29), ("have", 16.29, 16.46), ("a", 16.46, 16.52), ("good", 16.52, 16.76), ("day.", 16.76, 17.0)]]


class CaptionTest(unittest.TestCase):
    """The pure parts of captions, posters and speech timing: no Pillow and no ffmpeg needed."""

    def assertSound(self, caps, words, end):
        self.assertEqual(" ".join(c[2] for c in caps), " ".join(w["w"] for w in words), "every word, once, in order")
        for s, e, text in caps:
            self.assertGreaterEqual(e - s, 1.0 - 1e-9, text)
            self.assertLessEqual(e, end + 1e-9, text)
        for a, b in zip(caps, caps[1:]):
            self.assertLessEqual(a[1], b[0], "%r runs into %r" % (a[2], b[2]))

    def test_the_trials_words_break_at_sentences_then_commas_then_by_length(self):
        caps = video.caption_lines(TRIAL_WORDS, [(0.0, 19.9)])
        self.assertEqual(caps, [
            (0.0, 4.28, "This is a trial clip for the studio."),
            (4.28, 6.29, "We are testing captions today."),
            (6.29, 8.0, "The workshop opens at nine in the morning"),
            (8.0, 10.0, "and closes at six in the evening."),
            (10.0, 11.89, "Every order is packed by hand"),
            (11.89, 14.25, "and checked twice before it leaves."),
            (14.25, 16.22, "Thank you for watching this short test,"),
            (16.22, 17.22, "and have a good day."),       # 0.78 s spoken, held to 1 s from the silence after
        ])
        self.assertSound(caps, TRIAL_WORDS, 19.9)
        for _, _, text in caps:
            self.assertLessEqual(len(text), video.CAPTION_CHARS)
            self.assertNotIn(text.split()[-1].lower(), video.WEAK_END, text)

    def test_a_short_caption_borrows_the_silence_after_it_and_never_runs_into_the_next(self):
        w = lambda *xs: [{"w": a, "from": b, "to": c} for a, b, c in xs]
        # Silence follows: held to one second.
        words = w(("Yes.", 0.0, 0.3), ("Then", 2.0, 2.4), ("we", 2.4, 2.6), ("go.", 2.6, 3.4))
        self.assertEqual(video.caption_lines(words, [(0, 5)])[0], (0.0, 1.0, "Yes."))
        # Only 0.4 s of silence: it ends where the next begins; the next is not moved, and nothing overlaps.
        words = w(("Yes.", 0.0, 0.3), ("Then", 0.7, 1.4), ("we", 1.4, 1.6), ("go", 1.6, 2.0), ("on.", 2.0, 2.8))
        caps = video.caption_lines(words, [(0, 5)])
        self.assertEqual(caps[0], (0.0, 1.0, "Yes."))
        self.assertEqual(caps[1][0], 1.0)
        self.assertSound(caps, words, 5)
        # Two short sentences straight after each other become one caption.
        words = w(("Yes.", 0.0, 0.3), ("No.", 0.3, 0.6), ("Then", 3.0, 3.5), ("we", 3.5, 3.7), ("go.", 3.7, 4.4))
        caps = video.caption_lines(words, [(0, 5)])
        self.assertEqual(caps[0], (0.0, 1.0, "Yes. No."))
        self.assertSound(caps, words, 5)
        # The last caption never outlasts the video.
        caps = video.caption_lines(w(("Bye.", 0.0, 0.4)), [(0, 0.7)])
        self.assertEqual(caps, [(0.0, 0.7, "Bye.")])

    def test_a_long_sentence_breaks_at_its_comma_before_its_length(self):
        text = "When the van comes, we load the boxes and drive them over to the shop on the corner."
        words = [{"w": t, "from": i * 0.3, "to": i * 0.3 + 0.28} for i, t in enumerate(text.split())]
        caps = video.caption_lines(words, [(0, 10)])
        self.assertEqual([c[2] for c in caps], ["When the van comes,", "we load the boxes and drive them",
                                                "over to the shop on the corner."])
        self.assertSound(caps, words, 10)
        for _, _, t in caps:
            self.assertLessEqual(len(t), video.CAPTION_CHARS)
        # A long pause inside a sentence also ends a caption.
        words = [{"w": "Wait", "from": 0.0, "to": 0.4}, {"w": "for", "from": 2.5, "to": 2.8},
                 {"w": "it.", "from": 2.8, "to": 3.4}]
        self.assertEqual([c[2] for c in video.caption_lines(words, [(0, 5)])], ["Wait", "for it."])

    def test_captions_across_a_cut_are_placed_on_the_cuts_timeline(self):
        caps = video.caption_lines(TRIAL_WORDS, [(0.0, 4.28), (10.0, 14.25)])
        self.assertEqual([c[2] for c in caps], ["This is a trial clip for the studio.", "Every order is packed by hand",
                                                "and checked twice before it leaves."])
        self.assertEqual(caps[1][0], 4.28)
        self.assertSound(caps, TRIAL_WORDS[:8] + TRIAL_WORDS[28:40], 8.53)

    def test_a_caption_is_on_screen_up_to_but_not_including_its_end(self):
        self.assertEqual(video.caption_enable(6.29, 8.0), "gte(t,6.290)*lt(t,8.000)")

    def test_speech_start_is_read_from_silencedetect(self):
        out = ("[silencedetect @ 0x1] silence_start: 0\n[silencedetect @ 0x1] silence_end: 1.23456 | "
               "silence_duration: 1.23456\n[silencedetect @ 0x1] silence_start: 4.1\n")
        self.assertEqual(video.leading_silence(out), 1.23)
        self.assertEqual(video.leading_silence("[silencedetect @ 0x1] silence_start: 2.5\n"), 0.0)
        self.assertEqual(video.leading_silence("size=N/A time=00:00:04.00\n"), 0.0, "no silence at all")
        self.assertIsNone(video.leading_silence("[silencedetect @ 0x1] silence_start: 0\n"), "silent all through")
        self.assertEqual(video.leading_silence("[silencedetect @ 0x1] silence_start: -0.000125\n"
                                               "[silencedetect @ 0x1] silence_end: 0.9 | x\n"), 0.9)

    def test_no_word_is_moved_before_speech_starts_and_the_order_holds(self):
        moved = video.clamp_to_speech(TRIAL_WORDS, 1.3)
        self.assertEqual([w["w"] for w in moved], [w["w"] for w in TRIAL_WORDS])
        for w in moved:
            self.assertGreaterEqual(w["from"], 1.3)
            self.assertLessEqual(w["from"], w["to"])
        for a, b in zip(moved, moved[1:]):
            self.assertLessEqual(a["to"], b["from"] + 1e-9)
        self.assertEqual(moved[4:], TRIAL_WORDS[4:], "words timed after speech starts keep their times")
        self.assertEqual(moved[3]["to"], 2.01)
        # None (not found) or no silence: unchanged.
        self.assertEqual(video.clamp_to_speech(TRIAL_WORDS, None), TRIAL_WORDS)
        self.assertEqual(video.clamp_to_speech(TRIAL_WORDS, 0.0), TRIAL_WORDS)
        # Every word before speech: they are put after it, in order.
        few = [{"w": "a", "from": 0.0, "to": 0.2}, {"w": "b", "from": 0.2, "to": 0.5}]
        out = video.clamp_to_speech(few, 2.0)
        self.assertEqual([(w["from"], w["to"]) for w in out], [(2.0, 2.08), (2.08, 2.2)])

    def test_the_caption_changes_at_the_middle_of_a_crossfade(self):
        shots = [{"seconds": 3.0}, {"seconds": 3.0}, {"seconds": 2.0}]
        starts, total = video.shot_starts(shots, 0.5)
        self.assertEqual((starts, total), ([0.0, 2.5, 5.0], 7.0))
        owner = lambda at: video.caption_owner(at, starts, 0.5)
        self.assertEqual([owner(t) for t in (0.0, 2.5, 2.74, 2.75, 3.0, 5.2, 5.25, 6.9)], [0, 0, 0, 1, 1, 1, 2, 2])
        self.assertEqual(video.shot_spans(shots, 0.5), [[0.0, 2.5], [3.0, 5.0], [5.5, 7.0]])
        self.assertEqual(video.caption_owner(10.0, [0.0], 0.0), 0)

    def test_the_poster_is_from_the_middle_of_the_longest_shot_and_never_on_a_caption_boundary(self):
        # Two shots: the middle of the longer one, not the middle of the video (which is in the crossfade).
        self.assertEqual(video.poster_time([[0.0, 5.5], [6.0, 11.5]], 11.5, (), 24), 2.75)
        self.assertEqual(video.poster_time([[0.0, 2.0], [2.5, 9.0]], 9.0, (), 24), 5.75)
        # One shot: one third in.
        self.assertAlmostEqual(video.poster_time(None, 6.0, (), 30), 2.0)
        self.assertAlmostEqual(video.poster_time([[0.0, 19.9]], 19.9, (), 30), 19.9 / 3)
        # One third in falls on a caption change: the middle of the caption it falls in.
        caps = video.caption_lines(TRIAL_WORDS, [(0.0, 24.0)])
        bounds = [t for s, e, _ in caps for t in (s, e)]
        t = video.poster_time([[0.0, 24.0]], 24.0, bounds, 30)    # one third in is 8.0, a caption change
        self.assertEqual(t, (6.29 + 8.0) / 2)
        self.assertTrue(all(abs(t - b) >= 2.0 / 30 for b in bounds))
        # The middle of the trial's 20-second clip (10.0) was a caption change; now it is not used at all.
        t = video.poster_time([[0.0, 20.0]], 20.0, bounds, 30)
        self.assertTrue(all(abs(t - b) >= 0.1 for b in bounds), t)
        # Squeezed between two close changes: the longest stretch of that shot instead.
        self.assertEqual(video.poster_time([[0.0, 9.0]], 9.0, [2.95, 3.05], 30), 6.025)
        # Never past the last frame.
        self.assertLess(video.poster_time([[0.0, 1.0]], 0.5, (), 10), 0.5)


class CaptionWrapTest(unittest.TestCase):
    """wrap_caption is pure: measured here by characters, 10 px each."""
    m = staticmethod(lambda t: 10 * len(t))

    def test_two_lines_are_balanced_and_no_short_word_is_left_alone(self):
        words = "The workshop opens at nine in the morning".split()
        lines = video.wrap_caption(words, self.m, 360)        # greedy would leave "morning" alone
        self.assertEqual(lines, ["The workshop opens at", "nine in the morning"])
        self.assertEqual(video.wrap_caption("and have a good day.".split(), self.m, 120), ["and have a", "good day."])
        self.assertEqual(video.wrap_caption(["Yes."], self.m, 30), None)
        self.assertEqual(video.wrap_caption(["Yes."], self.m, 40), ["Yes."])
        self.assertEqual(video.wrap_caption("Short one".split(), self.m, 400), ["Short one"])
        for lines in (video.wrap_caption("we load the boxes and drive them over".split(), self.m, w) for w in (200, 260, 300)):
            self.assertTrue(all(len(l.split()) > 1 for l in lines), lines)

    def test_too_long_for_three_lines_or_a_word_too_wide_is_none_never_cut(self):
        long = ("word " * 40).split()
        self.assertIsNone(video.wrap_caption(long, self.m, 300))
        got = video.wrap_caption(long[:15], self.m, 300)
        self.assertEqual(" ".join(got).split(), long[:15], "every word is kept")
        self.assertLessEqual(len(got), 3)
        self.assertIsNone(video.wrap_caption(["Supercalifragilistic"], self.m, 150))
        self.assertEqual(video.wrap_caption([], self.m, 100), [])


@unittest.skipUnless(HAVE_PIL, "Pillow is not there; the caption picture tests are skipped")
class CaptionPictureTest(unittest.TestCase):
    def test_the_trials_41_characters_at_54_px_on_1280_wide_wrap_evenly(self):
        from PIL import ImageDraw
        f = video.font("Avenir Next", 54)
        d = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
        lines = video.wrap_caption("The workshop opens at nine in the morning".split(),
                                   lambda t: d.textlength(t, font=f), int(1280 * 0.84))
        self.assertEqual(" ".join(lines), "The workshop opens at nine in the morning")
        if len(lines) == 2:
            a, b = (d.textlength(l, font=f) for l in lines)
            self.assertLess(abs(a - b) / max(a, b), 0.4, lines)
        self.assertTrue(all(len(l.split()) > 1 for l in lines), lines)
        im = video.caption_picture("The workshop opens at nine in the morning", 1280, 720,
                                   {"font": "Avenir Next", "size": 54})
        self.assertEqual(im.size, (1280, 720))

    def test_a_long_caption_steps_down_and_one_that_cannot_fit_is_refused_by_name(self):
        text = " ".join(["several more words"] * 4)        # too long for three lines at 96 px on 640 wide
        im = video.caption_picture(text, 640, 360, {"size": 96})
        self.assertEqual(im.size, (640, 360))
        with self.assertRaises(video.Problem) as cm:
            video.caption_picture(" ".join(["several more words"] * 40), 640, 360, {"size": 96})
        msg = str(cm.exception)
        self.assertIn('the caption "several more words', msg)
        self.assertIn("does not fit in 3 lines, even at 24 px; shorten it or split it", msg)
        with self.assertRaises(video.Problem) as cm:
            video.caption_picture("Pneumonoultramicroscopicsilicovolcanoconiosis", 320, 180, {"size": 60})
        self.assertIn("Pneumonoultramicroscopicsilicovolcanoconiosis", str(cm.exception))


@unittest.skipUnless(HAVE_FFMPEG, "ffmpeg is not there; the caption timing test with ffmpeg is skipped")
class CaptionTimingTest(unittest.TestCase):
    """Two captions that touch, drawn the way `cut` draws them: no frame may carry both."""

    def frames_with(self, enable_a, enable_b):
        w, h, fps = 64, 16, 25
        graph = ("[0:v][1:v]overlay=0:0:enable='%s'[a];[a][2:v]overlay=32:0:enable='%s'[out]" % (enable_a, enable_b))
        out = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin",
                              "-f", "lavfi", "-i", "color=black:s=%dx%d:r=%d:d=2" % (w, h, fps),
                              "-f", "lavfi", "-i", "color=red:s=16x16:r=%d:d=2" % fps,
                              "-f", "lavfi", "-i", "color=blue:s=16x16:r=%d:d=2" % fps,
                              "-filter_complex", graph, "-map", "[out]", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                             capture_output=True, check=True, timeout=60).stdout
        size = w * h * 3
        frames = [out[i:i + size] for i in range(0, len(out), size)]
        px = lambda f, x: tuple(f[(8 * w + x) * 3:(8 * w + x) * 3 + 3])
        return [(px(f, 8)[0] > 200 and px(f, 8)[2] < 60, px(f, 40)[2] > 200 and px(f, 40)[0] < 60) for f in frames]

    def test_two_captions_that_touch_never_share_a_frame(self):
        seen = self.frames_with(video.caption_enable(0.0, 1.0), video.caption_enable(1.0, 2.0))
        self.assertEqual(len(seen), 50)
        self.assertFalse(any(a and b for a, b in seen), "a frame carries both captions")
        self.assertTrue(all(a or b for a, b in seen), "a frame carries neither")
        self.assertEqual([i for i, (a, b) in enumerate(seen) if b][0], 25, "the second starts on its own frame")
        # The old way (`between`, both ends in) put both on the frame at 1.0 s: the fault the trial saw.
        old = self.frames_with("between(t,0.000,1.000)", "between(t,1.000,2.000)")
        self.assertTrue(any(a and b for a, b in old))


@unittest.skipUnless(HAVE_PIL, "Pillow is not there; the crossfade caption test is skipped")
class RevealCaptionTest(unittest.TestCase):
    def test_a_crossfade_never_blends_two_captions(self):
        root = tempfile.mkdtemp(prefix="uuu-video-test-")
        saved = video.caption_picture
        try:
            for name, colour in (("a.png", (200, 200, 200)), ("b.png", (40, 40, 40))):
                Image.new("RGB", (40, 30), colour).save(os.path.join(root, name))

            def marked(text, w, h, style=None):     # a solid mark per caption, so a blend would show
                im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
                im.paste((255, 0, 0, 255) if text == "first" else (0, 0, 255, 255), (0, 0, 8, 8))
                return im
            video.caption_picture = marked
            shots = [{"path": os.path.join(root, "a.png"), "seconds": 1.0, "move": "still", "caption": "first"},
                     {"path": os.path.join(root, "b.png"), "seconds": 1.0, "move": "still", "caption": "second"}]
            frames = list(video.reveal_frames(40, 30, 20, {}, shots, 0.5))
            self.assertEqual(len(frames), 30)
            marks = [f.getpixel((2, 2)) for f in frames]
            self.assertTrue(all(m in ((255, 0, 0), (0, 0, 255)) for m in marks), marks)
            change = marks.index((0, 0, 255))
            self.assertEqual(change, 15, "the caption changes at 0.75 s, the middle of the 0.5 to 1.0 s crossfade")
            self.assertEqual(set(marks[change:]), {(0, 0, 255)})
            mid = frames[12].getpixel((30, 20))               # the pictures themselves still crossfade
            self.assertTrue(40 < mid[0] < 200, mid)
        finally:
            video.caption_picture = saved
            shutil.rmtree(root, ignore_errors=True)


class FreeDiskTest(unittest.TestCase):
    def test_under_10_gb_free_refuses_to_start(self):
        with self.assertRaises(video.Problem) as cm:
            video.check_free(10 * video.GB - 1)
        self.assertIn("at least 10 GB free", str(cm.exception))
        video.check_free(10 * video.GB)
        video.check_free(27 * video.GB)

    def test_the_goals_folder_holds_at_most_2_gb(self):
        root = tempfile.mkdtemp(prefix="uuu-video-test-")
        try:
            goal = os.path.join(root, "company-work", "STH-1")
            os.makedirs(goal)
            self.assertEqual(video.output_cap(goal), video.MAX_OUTPUT_BYTES)
            with open(os.path.join(goal, "big.bin"), "wb") as fh:
                fh.truncate(2 * video.GB - 100 * video.MB)    # sparse: takes no disk
            self.assertEqual(video.output_cap(goal), 100 * video.MB)
            with open(os.path.join(goal, "more.bin"), "wb") as fh:
                fh.truncate(100 * video.MB)
            with self.assertRaises(video.Problem):
                video.output_cap(goal)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_the_goal_folder_is_two_up_from_video_name(self):
        homes = ("/t/company-work", "/t/_proof")
        self.assertEqual(video.goal_folder("/t/company-work/STH-1/video/title", homes),
                         "/t/company-work/STH-1")
        self.assertEqual(video.goal_folder("/t/_proof/art-check/video/clip", homes), "/t/_proof/art-check")
        # anywhere else is refused, a look-alike company-work inside a goal too
        for bad in ("/t/company-work/STH-1", "/t/company-work/STH-1/video",
                    "/t/company-work/STH-1/clips/a", "/t/company-work/STH-1/video/title/sub",
                    "/t/company-work/STH-1/other/video/a",
                    "/t/company-work/STH-1/company-work/x/video/a",
                    "/t/company-work/STH-1/video/Bad_Name", "/t/_proof/art-check", "/t/STH-1/video/title",
                    # a made-up goal is not a fresh goal with nothing in it
                    "/t/company-work/ANY-NAME/video/b", "/t/company-work/notes/video/b",
                    # a company-work folder outside the pinned task-folder tree
                    "/home/agent/company-work/STH-1/video/a", "/t/x/company-work/STH-1/video/a"):
            with self.assertRaises(video.Problem, msg=bad):
                video.goal_folder(bad, homes)
        # Installed, the homes come from where the tool lives, never from a variable.
        self.assertEqual(video.TASK_HOMES, (os.path.join(video.STATE, "tasks", "company-work"),
                                            os.path.join(video.STATE, "tasks", "_proof")))
        with self.assertRaises(video.Problem):
            video.goal_folder("/t/company-work/STH-1/video/title")

    def test_the_goal_is_found_through_links_and_letter_case(self):
        root = os.path.realpath(tempfile.mkdtemp(prefix="uuu-video-test-"))
        try:
            home = os.path.join(root, "tasks", "company-work")
            own = os.path.join(home, "STH-3", "video", "a")
            os.makedirs(own)
            homes = (home,)
            # A folder the agent links to from elsewhere is judged where it really is.
            os.symlink(os.path.join(home, "STH-3"), os.path.join(root, "elsewhere"))
            self.assertEqual(video.goal_folder(os.path.join(root, "elsewhere", "video", "a"), homes),
                             os.path.join(home, "STH-3"))
            # A link inside the tree that leads outside it is refused.
            outside = os.path.join(root, "outside", "video", "a")
            os.makedirs(outside)
            os.symlink(os.path.join(root, "outside"), os.path.join(home, "STH-4"))
            with self.assertRaises(video.Problem):
                video.goal_folder(os.path.join(home, "STH-4", "video", "a"), homes)
            # The disk ignores letter case, and so does the match.
            self.assertEqual(video.goal_folder(own, (home.upper(),)).lower(), os.path.join(home, "STH-3").lower())
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_files_moved_away_and_left_as_links_still_count(self):
        root = tempfile.mkdtemp(prefix="uuu-video-test-")
        try:
            goal = os.path.join(root, "company-work", "STH-5")
            away = os.path.join(root, "agent-home")
            os.makedirs(os.path.join(goal, "video", "a"))
            os.makedirs(os.path.join(away, "more"))
            with open(os.path.join(away, "big.bin"), "wb") as fh:
                fh.truncate(2 * video.GB + video.MB)          # sparse: takes no disk
            os.symlink(os.path.join(away, "big.bin"), os.path.join(goal, "video", "a", "big.bin"))
            with self.assertRaises(video.Problem):
                video.output_cap(goal)
            os.remove(os.path.join(goal, "video", "a", "big.bin"))
            os.rename(os.path.join(away, "big.bin"), os.path.join(away, "more", "big.bin"))
            os.symlink(os.path.join(away, "more"), os.path.join(goal, "linked-folder"))
            os.symlink(goal, os.path.join(goal, "loop"))     # a loop is walked once
            with self.assertRaises(video.Problem):
                video.output_cap(goal)
            # The same file under two names is counted once.
            os.remove(os.path.join(goal, "linked-folder"))
            with open(os.path.join(goal, "half.bin"), "wb") as fh:
                fh.truncate(video.GB)
            os.link(os.path.join(goal, "half.bin"), os.path.join(goal, "half-again.bin"))
            self.assertEqual(video.output_cap(goal), video.MAX_OUTPUT_BYTES)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_every_goals_video_folders_together_hold_at_most_10_gb(self):
        root = tempfile.mkdtemp(prefix="uuu-video-test-")
        try:
            home = os.path.join(root, "company-work")
            for n in range(1, 7):
                v = os.path.join(home, "STH-%d" % n, "video", "a")
                os.makedirs(v)
                with open(os.path.join(v, "a.mp4"), "wb") as fh:
                    fh.truncate(int(1.8 * video.GB))          # sparse: takes no disk
            fresh = os.path.join(home, "STH-99")
            os.makedirs(os.path.join(fresh, "video", "b"))
            with self.assertRaises(video.Problem) as cm:
                video.output_cap(fresh)
            self.assertIn("all goals", str(cm.exception))
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_sources_come_only_from_folders_found_from_where_the_tool_lives(self):
        root = tempfile.mkdtemp(prefix="uuu-video-test-")
        saved = os.environ.get("UUU_KNOWLEDGE_DIR")
        try:
            goal = os.path.join(root, "company-work", "STH-6")
            other = os.path.join(root, "company-work", "STH-7")
            os.makedirs(os.path.join(goal, "video", "a"))
            os.makedirs(other)
            with open(os.path.join(other, "theirs.mp4"), "wb") as fh:
                fh.write(b"x")
            os.environ["UUU_KNOWLEDGE_DIR"] = root
            with self.assertRaises(video.Problem):
                video.find_input(os.path.join(other, "theirs.mp4"), os.path.join(goal, "video", "a"), goal,
                                 video.CLIP_ENDINGS, "clip", video.MAX_SOURCE_BYTES)
            self.assertEqual(video.KNOWLEDGE, os.path.join(video.STATE, "knowledge", "docs"))
            self.assertEqual(video.ROOM, os.path.join(video.STATE, "media", "room"))
        finally:
            if saved is None:
                os.environ.pop("UUU_KNOWLEDGE_DIR", None)
            else:
                os.environ["UUU_KNOWLEDGE_DIR"] = saved
            shutil.rmtree(root, ignore_errors=True)


class StopTest(unittest.TestCase):
    def test_the_stop_reaches_what_a_child_started(self):
        root = tempfile.mkdtemp(prefix="uuu-video-test-")
        try:
            pidfile = os.path.join(root, "pid")
            code = ("import subprocess, sys\n"
                    "p = subprocess.Popen(['/bin/sleep', '47'])\n"
                    "open(sys.argv[1], 'w').write(str(p.pid))\n"
                    "sys.exit(1)\n")
            child = video.start([sys.executable, "-c", code, pidfile])
            child.wait(timeout=30)
            with open(pidfile) as fh:
                grandchild = int(fh.read())
            os.kill(grandchild, 0)                             # still running after the child left
            video.stop_children()
            for _ in range(50):
                try:
                    os.kill(grandchild, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.1)
            with self.assertRaises(ProcessLookupError):
                os.kill(grandchild, 0)
        finally:
            del video.CHILDREN[:]
            shutil.rmtree(root, ignore_errors=True)

    def test_render_from_outside_video_name_is_refused_while_the_goal_is_full(self):
        root = tempfile.mkdtemp(prefix="uuu-video-test-")
        try:
            goal = os.path.join(root, "company-work", "STH-9")
            homes = (os.path.join(root, "company-work"),)
            other = os.path.join(goal, "other", "x")
            own = os.path.join(goal, "video", "clip")
            os.makedirs(other)
            os.makedirs(own)
            with open(os.path.join(goal, "big.bin"), "wb") as fh:
                fh.truncate(2 * video.GB + video.MB)    # sparse: takes no disk
            for where in (other, own):
                with open(os.path.join(where, "x.py"), "w") as fh:
                    fh.write("size = (16, 16)\nfps = 1\nframes = iter(())\n")
            env = {k: v for k, v in os.environ.items() if not k.startswith("UUU_")}
            env.update(UUU_FFMPEG="/usr/bin/false", UUU_FFPROBE="/usr/bin/false")
            r = subprocess.run([sys.executable, VIDEO, "render", "x.py"], cwd=other, env=env,
                               capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 1)
            self.assertIn("<goal>/video/<name>", r.stderr)
            self.assertEqual(os.listdir(other), ["x.py"])
            with self.assertRaises(video.Problem) as cm:
                video.output_cap(video.goal_folder(os.path.realpath(own), homes))
            self.assertIn("at most 2 GB", str(cm.exception))
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
