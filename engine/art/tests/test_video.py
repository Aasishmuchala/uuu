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


def script(size="(64, 64)", fps="10", count="20", frames=True):
    text = "from PIL import Image\n\nsize = %s\nfps = %s\n" % (size, fps)
    if frames:
        text += "frames = [Image.new('RGB', size, (i * 10 %% 255, 40, 80)) for i in range(%s)]\n" % count
    return text


@unittest.skipUnless(HAVE_PIL and HAVE_FFMPEG,
                     "Pillow or ffmpeg is not there (run engine/art/install.sh); video tests skipped")
class VideoTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="uuu-video-test-")
        self.goal = os.path.join(self.root, "company-work", "STH-25")
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
        return subprocess.run([sys.executable, VIDEO] + list(args), cwd=self.dir, env=env or self.env(),
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
        self.assertEqual(m["seconds"], 3)

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
        del e["UUU_STT_MODEL"]
        r = self.run_video("words", "../../talk.mp4", env=e)
        self.assertEqual(r.returncode, 1)
        self.assertIn("UUU_STT_MODEL is not set", r.stderr)


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
            self.assertEqual(video.output_cap(root), video.MAX_OUTPUT_BYTES)
            with open(os.path.join(root, "big.bin"), "wb") as fh:
                fh.truncate(2 * video.GB - 100 * video.MB)    # sparse: takes no disk
            self.assertEqual(video.output_cap(root), 100 * video.MB)
            with open(os.path.join(root, "more.bin"), "wb") as fh:
                fh.truncate(100 * video.MB)
            with self.assertRaises(video.Problem):
                video.output_cap(root)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_the_goal_folder_is_two_up_from_video_name(self):
        self.assertEqual(video.goal_folder("/t/company-work/STH-1/video/title"),
                         "/t/company-work/STH-1")
        self.assertEqual(video.goal_folder("/t/_proof/art-check/video/clip"), "/t/_proof/art-check")
        # anywhere else is refused, a look-alike company-work inside a goal too
        for bad in ("/t/company-work/STH-1", "/t/company-work/STH-1/video",
                    "/t/company-work/STH-1/clips/a", "/t/company-work/STH-1/video/title/sub",
                    "/t/company-work/STH-1/other/video/a",
                    "/t/company-work/STH-1/company-work/x/video/a",
                    "/t/company-work/STH-1/video/Bad_Name", "/t/_proof/art-check", "/t/STH-1/video/title"):
            with self.assertRaises(video.Problem, msg=bad):
                video.goal_folder(bad)

    def test_render_from_outside_video_name_is_refused_while_the_goal_is_full(self):
        root = tempfile.mkdtemp(prefix="uuu-video-test-")
        try:
            goal = os.path.join(root, "company-work", "STH-9")
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
                video.output_cap(video.goal_folder(os.path.realpath(own)))
            self.assertIn("at most 2 GB", str(cm.exception))
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
