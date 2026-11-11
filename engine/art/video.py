#!/usr/bin/env python3
"""Makes short videos for the Artist: from a drawing script, from pictures, or
by cutting a clip; and takes the words out of a clip.

SAFETY: `render` runs code an agent wrote. Run this only inside the fence, in
the Artist's task folder, the way the Artist does:

    cd <goal>/video/<name> && "$UUU_ART_PYTHON" "$UUU_ART_VIDEO" <command> ...

Never run it on an agent's files outside the fence, and never from the home
server: the home server only lists, checks and serves the files this writes.

Commands (CONTRACTS-V3 37.2):
  render <name>.py     runs the script in a child Python; the script leaves
                       `size` (w, h), `fps`, `frames` (Pillow images, a list or
                       an iterator) and optionally `title` and `audio` (a file
                       in the goal's folder). The frames are piped into ffmpeg
                       and never kept on disk. Writes <name>.mp4.
  reveal <name>.json   {"size", "fps", "title"?, "shots": [{"image", "seconds",
                       "move": in|out|left|right|still, "caption"?}]}: slow pans
                       or zooms over pictures, crossfades, caption pictures.
                       Writes <name>.mp4.
  words <clip>         takes the sound out of a clip and writes words.json:
                       [{"w", "from", "to"}]. Needs $UUU_STT and $UUU_STT_MODEL.
  cut <name>.json      {"source", "keep": [[from, to]], "captions":
                       "words.json" | null, "caption_style"?, "title"?}. With a
                       words.json no cut lands inside a word. Writes <name>.mp4.
  stills <name>.mp4    writes review/frame-01.png to frame-06.png (six frames
                       spread evenly, at most 640 px wide).

render, reveal and cut end by writing poster.png (the middle frame), the six
stills and, last, manifest.json. One plain line on success; a problem is one
line starting `video:` and exit 1.

Limits, held here and not by the agent's goodwill: at most 1920 x 1080 with
even sides; at most 30 frames a second; at most 120 seconds of output; a source
clip of at most 5 minutes and 1 GB; ffmpeg's -fs of 300 MB on every output; a
file-size limit of 2 GB on this process and every process it starts; it will
not start with under 10 GB of free disk; it stops the work after 10 minutes;
at most 2 GB of files in one goal's folder. The agent's script runs in a child
process, so nothing it does can lift a limit this process holds.

Tools come only from $UUU_FFMPEG, $UUU_FFPROBE, $UUU_STT and $UUU_STT_MODEL
(absolute paths, written by engine/art/install.sh into the Artist's key file).
A missing variable is a problem, never a search of PATH.

Installed by engine/art/install.sh as state/art/tools/video.py and run with the
Artist's own Python (state/art/venv). Standard library and Pillow only.
"""
import datetime
import io
import json
import math
import os
import re
import resource
import runpy
import signal
import struct
import subprocess
import sys
import tempfile
import time
import traceback

NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
MB = 1024 * 1024
GB = 1024 * MB
MAX_W, MAX_H = 1920, 1080
MAX_FPS = 30
MAX_SECONDS = 120
MAX_SOURCE_SECONDS = 300
MAX_SOURCE_BYTES = 1 * GB
MAX_OUTPUT_BYTES = 300 * MB
MAX_FILE_BYTES = 2 * GB          # RLIMIT_FSIZE on this process and its children
MIN_FREE_BYTES = 10 * GB
MAX_WALL_SECONDS = 600
MAX_GOAL_BYTES = 2 * GB
MAX_TITLE = 120
MAX_CAPTION = 200
MAX_SHOTS = 40
MAX_KEEP = 100
MAX_CAPTIONS = 200
MAX_WORDS = 20000
MAX_JSON_BYTES = 2 * MB
MAX_PICTURE_BYTES = 50 * MB
MAX_PICTURE_PIXELS = 50 * 1000 * 1000
STILLS = 6
STILL_MAX_W = 640
MOVES = ("in", "out", "left", "right", "still")
PICTURE_ENDINGS = (".png", ".jpg", ".jpeg", ".webp")
CLIP_ENDINGS = (".mp4", ".mov", ".m4v")
SOUND_ENDINGS = (".mp3", ".m4a", ".wav")

HERE = os.path.dirname(os.path.abspath(__file__))
# The room is state/media/room; this tool lives in state/art/tools.
ROOM = os.path.realpath(os.path.join(HERE, "..", "..", "media", "room"))

START = time.monotonic()
CHILDREN = []      # processes to stop when the time is up or on a problem
TEMPS = []         # files to remove whatever happens


class Problem(Exception):
    pass


# --- Small helpers ---------------------------------------------------------------

def whole(x):
    return isinstance(x, int) and not isinstance(x, bool)


def number(x):
    return (isinstance(x, (int, float)) and not isinstance(x, bool)
            and math.isfinite(x))


def plural(n, one, many=None):
    return "%d %s" % (n, one if n == 1 else (many or one + "s"))


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def json_bytes(obj):
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def write_atomic(path, data):
    tmp = "%s.%d.tmp" % (path, os.getpid())
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def temp_path(folder, name, ending):
    path = os.path.join(folder, ".%s.%d.tmp%s" % (name, os.getpid(), ending))
    TEMPS.append(path)
    return path


def remove_temps():
    for p in TEMPS:
        try:
            if os.path.isdir(p) and not os.path.islink(p):
                for f in os.listdir(p):
                    os.remove(os.path.join(p, f))
                os.rmdir(p)
            elif os.path.lexists(p):
                os.remove(p)
        except OSError:
            pass


def stop_children():
    for p in CHILDREN:
        try:
            if p.poll() is None:
                p.kill()
                p.wait(timeout=5)
        except Exception:
            pass


def remaining():
    left = MAX_WALL_SECONDS - (time.monotonic() - START)
    if left <= 0:
        raise Problem("the work took longer than 10 minutes and was stopped")
    return left


def out_of_time(signum, frame):
    # Not an exception: nothing can catch it. Stop, clean up, say so, leave.
    stop_children()
    remove_temps()
    try:
        sys.stderr.write("video: the work took longer than 10 minutes and was stopped\n")
        sys.stderr.flush()
    finally:
        os._exit(1)


def hold_limits():
    """The process-wide limits. Children inherit them and cannot raise them."""
    soft, hard = resource.getrlimit(resource.RLIMIT_FSIZE)
    cap = MAX_FILE_BYTES if hard == resource.RLIM_INFINITY else min(hard, MAX_FILE_BYTES)
    resource.setrlimit(resource.RLIMIT_FSIZE, (cap, cap))
    signal.signal(signal.SIGXFSZ, signal.SIG_IGN)   # a write past the limit fails instead of killing
    signal.signal(signal.SIGALRM, out_of_time)
    signal.alarm(MAX_WALL_SECONDS)


def check_free(free_bytes):
    """Refuses to start below 10 GB of free disk. The number is passed in."""
    if free_bytes < MIN_FREE_BYTES:
        raise Problem("only %.1f GB of disk is free; a video needs at least 10 GB free to start. "
                      "Ask the owner to free some disk." % (free_bytes / float(GB)))


def free_bytes_at(folder):
    st = os.statvfs(folder)
    return st.f_bavail * st.f_frsize


GOAL_HOMES = ("company-work", "_proof")   # tasks/company-work/<goal>; the fence check's tasks/_proof/<goal>


def goal_folder(cwd):
    """.../company-work/<goal>/video/<name> -> <goal>. Anywhere else is refused.

    The goal is found from the outermost company-work (or _proof) folder, which an
    agent cannot make above its own task folder, so a nested look-alike cannot
    shrink the goal whose 2 GB is counted."""
    parts = cwd.split(os.sep)
    homes = [i for i, p in enumerate(parts) if p in GOAL_HOMES]
    if homes:
        i = homes[0]
        if (len(parts) == i + 4 and parts[i + 1] and parts[i + 2] == "video"
                and NAME.match(parts[i + 3])):
            return os.sep.join(parts[:i + 2])
    raise Problem("run the video helper from the folder for this one video: "
                  "<goal>/video/<name>, with a name of a to z, 0 to 9 and -")


def bytes_in(folder, cap=200000):
    total, seen = 0, 0
    for root, dirs, files in os.walk(folder, followlinks=False):
        for f in files:
            seen += 1
            if seen > cap:
                raise Problem("the goal's folder holds more than %d files; tidy it first" % cap)
            try:
                st = os.lstat(os.path.join(root, f))
            except OSError:
                continue
            if not os.path.islink(os.path.join(root, f)):
                total += st.st_size
    return total


def output_cap(goal):
    used = bytes_in(goal)
    left = MAX_GOAL_BYTES - used
    if left < 4 * MB:
        raise Problem("the goal's folder already holds %.1f GB of files; at most 2 GB is allowed. "
                      "Remove old videos first." % (used / float(GB)))
    return min(MAX_OUTPUT_BYTES, left)


def tool(var):
    path = os.environ.get(var, "")
    if not path:
        raise Problem("%s is not set, so the video tools are not installed for you. "
                      "Ask the owner to run engine/art/install.sh" % var)
    if not os.path.isabs(path) or not os.path.isfile(path):
        raise Problem("%s does not name a file that exists" % var)
    return path


def runnable(var):
    path = tool(var)
    if not os.access(path, os.X_OK):
        raise Problem("%s does not name a program" % var)
    return path


def plain_name(arg, endings, what):
    if "/" in arg or arg.startswith("."):
        raise Problem("give the %s's file name in this folder, with no folder in front" % what)
    if not arg.lower().endswith(endings):
        raise Problem("the %s's name must end with %s" % (what, " or ".join(endings)))
    name = arg[:arg.rfind(".")]
    if not NAME.match(name):
        raise Problem("the %s's name may only use a to z, 0 to 9 and -, and start with a letter "
                      "or digit, at most 40 characters (got %r)" % (what, arg))
    return name


def inside(path, folder):
    folder = os.path.realpath(folder)
    return path == folder or path.startswith(folder + os.sep)


def find_input(arg, cwd, goal, endings, what, max_bytes):
    """A file in the goal's folder, in the room, or in the company's files."""
    if not isinstance(arg, str) or not arg or len(arg) > 400 or "\x00" in arg:
        raise Problem("the %s must be a file name" % what)
    if not arg.lower().endswith(endings):
        raise Problem("the %s %s must end with %s" % (what, json.dumps(arg), ", ".join(endings)))
    roots = [goal, ROOM]
    knowledge = os.environ.get("UUU_KNOWLEDGE_DIR", "")
    if knowledge and os.path.isabs(knowledge):
        roots.append(knowledge)
    candidates = [arg] if os.path.isabs(arg) else [os.path.join(cwd, arg)]
    if not os.path.isabs(arg) and "/" not in arg:
        candidates.append(os.path.join(ROOM, arg))
    for c in candidates:
        real = os.path.realpath(c)
        if not any(inside(real, r) for r in roots):
            continue
        if not os.path.isfile(real):
            continue
        size = os.path.getsize(real)
        if size > max_bytes:
            raise Problem("the %s %s is %.0f MB; at most %d MB is allowed"
                          % (what, json.dumps(arg), size / float(MB), max_bytes // MB))
        return real
    raise Problem("there is no %s named %s in the goal's folder or the room" % (what, json.dumps(arg)))


def read_json_file(arg, cwd, what):
    path = os.path.join(cwd, arg)
    if not os.path.isfile(path):
        raise Problem("there is no %s named %s here" % (what, arg))
    if os.path.getsize(path) > MAX_JSON_BYTES:
        raise Problem("%s is larger than 2 MB" % arg)
    try:
        with open(path, "rb") as fh:
            return json.loads(fh.read().decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        raise Problem("%s is not valid JSON: %s" % (arg, str(e).splitlines()[0][:160]))


def check_size(size):
    if isinstance(size, dict):
        size = (size.get("w"), size.get("h"))
    if not isinstance(size, (list, tuple)) or len(size) != 2:
        raise Problem("`size` must be (width, height) in pixels")
    w, h = size
    if not whole(w) or not whole(h):
        raise Problem("`size` must be two whole numbers of pixels")
    if not (2 <= w <= MAX_W and 2 <= h <= MAX_H):
        raise Problem("the size %d × %d is too large or too small; at most %d × %d" % (w, h, MAX_W, MAX_H))
    if w % 2 or h % 2:
        raise Problem("the size %d × %d has an odd side; both sides must be even numbers" % (w, h))
    return w, h


def check_fps(fps):
    if not whole(fps) or not 1 <= fps <= MAX_FPS:
        raise Problem("`fps` must be a whole number of frames a second from 1 to %d" % MAX_FPS)
    return fps


def check_title(title, name):
    if title is None:
        return name
    if not isinstance(title, str) or not title.strip():
        raise Problem("`title` must be a short line of text")
    title = " ".join(title.split())
    if len(title) > MAX_TITLE:
        raise Problem("`title` is longer than %d characters" % MAX_TITLE)
    return title


def fit(w, h, max_w=MAX_W, max_h=MAX_H):
    """The largest even size of the same shape that fits."""
    scale = min(1.0, max_w / float(w), max_h / float(h))
    nw, nh = int(w * scale) // 2 * 2, int(h * scale) // 2 * 2
    return max(2, nw), max(2, nh)


# --- Running ffmpeg and friends ---------------------------------------------------

def start(cmd, **kw):
    try:
        p = subprocess.Popen(cmd, **kw)
    except OSError as e:
        raise Problem("%s could not be started: %s" % (os.path.basename(cmd[0]), e.strerror or e))
    CHILDREN.append(p)
    return p


def last_line(data):
    text = data.decode("utf-8", "replace") if isinstance(data, bytes) else (data or "")
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    return lines[-1][:200] if lines else "no reason given"


def run(cmd, what):
    p = start(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        out, err = p.communicate(timeout=remaining())
    except subprocess.TimeoutExpired:
        p.kill()
        raise Problem("the work took longer than 10 minutes and was stopped")
    if p.returncode != 0:
        raise Problem("%s failed: %s" % (what, last_line(err)))
    return out


def probe(path, ffprobe):
    out = run([ffprobe, "-v", "error", "-show_entries",
               "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate",
               "-of", "json", path], "reading the clip")
    try:
        data = json.loads(out.decode("utf-8"))
        duration = float(data.get("format", {}).get("duration", "nan"))
    except (ValueError, AttributeError):
        raise Problem("the clip could not be read")
    video = audio = None
    for s in data.get("streams", []):
        if s.get("codec_type") == "video" and video is None:
            video = s
        elif s.get("codec_type") == "audio" and audio is None:
            audio = s
    if not math.isfinite(duration) or duration <= 0:
        raise Problem("the clip has no length")
    fps = None
    if video:
        try:
            a, b = video.get("r_frame_rate", "0/1").split("/")
            fps = float(a) / float(b) if float(b) else None
        except ValueError:
            fps = None
    return {"duration": duration, "video": video, "audio": audio, "fps": fps}


def check_source(path, ffprobe, need_video=True):
    info = probe(path, ffprobe)
    if info["duration"] > MAX_SOURCE_SECONDS + 0.5:
        raise Problem("the clip is %d seconds long; at most 5 minutes is allowed" % int(info["duration"]))
    if need_video and not info["video"]:
        raise Problem("the clip has no picture")
    return info


def x264_args(cap):
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", "-fs", str(cap), "-f", "mp4"]


def frame_png(video, at, ffmpeg, scale=None):
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", "%.3f" % max(0.0, at),
           "-i", video, "-frames:v", "1"]
    if scale:
        cmd += ["-vf", scale]
    cmd += ["-f", "image2pipe", "-c:v", "png", "-fs", str(20 * MB), "pipe:1"]
    data = run(cmd, "taking a frame out of the video")
    if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) < 24:
        raise Problem("a frame could not be taken out of the video")
    return data


def png_size(data):
    return struct.unpack(">II", data[16:24])


# --- The finish every video command shares ----------------------------------------

def write_stills(folder, video, ffmpeg, ffprobe, duration=None):
    if duration is None:
        duration = probe(video, ffprobe)["duration"]
    review = os.path.join(folder, "review")
    if os.path.islink(review) or (os.path.exists(review) and not os.path.isdir(review)):
        raise Problem("review is not a folder here; remove it and run again")
    stills = []
    for i in range(STILLS):
        at = duration * (i + 0.5) / STILLS
        data = frame_png(video, min(at, max(0.0, duration - 0.05)), ffmpeg,
                         "scale='min(%d,iw)':-2" % STILL_MAX_W)
        w, _ = png_size(data)
        if w > STILL_MAX_W:
            raise Problem("a still came out wider than %d px" % STILL_MAX_W)
        stills.append(data)
    os.makedirs(review, exist_ok=True)
    for i, data in enumerate(stills):
        write_atomic(os.path.join(review, "frame-%02d.png" % (i + 1)), data)
    return ["review/frame-%02d.png" % (i + 1) for i in range(STILLS)]


def finish(folder, name, tmp_video, title, made_by, script, w, h, fps, expected, ffmpeg, ffprobe):
    """Checks the made video, then writes it, the poster, the stills and the manifest."""
    if not os.path.isfile(tmp_video):
        raise Problem("ffmpeg wrote no video")
    size = os.path.getsize(tmp_video)
    if size > MAX_OUTPUT_BYTES:
        raise Problem("the video is larger than 300 MB")
    with open(tmp_video, "rb") as fh:
        head = fh.read(12)
    if head[4:8] != b"ftyp":
        raise Problem("ffmpeg did not write an MP4")
    info = probe(tmp_video, ffprobe)
    v = info["video"] or {}
    if v.get("codec_name") != "h264" or (v.get("width"), v.get("height")) != (w, h):
        raise Problem("the video on disk is not the size it should be")
    seconds = info["duration"]
    if seconds > MAX_SECONDS + 0.5:
        raise Problem("the video is longer than %d seconds" % MAX_SECONDS)
    if expected and seconds < expected - max(0.5, 2.0 / fps):
        raise Problem("the video stopped at %.1f of %.1f seconds: it reached the size limit "
                      "(300 MB, or what is left of 2 GB in the goal's folder)" % (seconds, expected))
    poster = frame_png(tmp_video, seconds / 2.0, ffmpeg)
    if png_size(poster) != (w, h):
        raise Problem("the poster is not the size of the video")

    video_name = name + ".mp4"
    os.replace(tmp_video, os.path.join(folder, video_name))
    write_atomic(os.path.join(folder, "poster.png"), poster)
    write_stills(folder, os.path.join(folder, video_name), ffmpeg, ffprobe, seconds)
    manifest = {
        "name": name, "title": title, "kind": "video", "video": video_name, "poster": "poster.png",
        "width": w, "height": h, "fps": fps, "seconds": max(1, int(round(seconds))), "bytes": size,
        "made_by": made_by, "script": script, "made_at": now(),
    }
    write_atomic(os.path.join(folder, "manifest.json"), json_bytes(manifest))
    weight = "%.1f MB" % (size / float(MB)) if size >= MB else "%d KB" % max(1, size // 1024)
    return "%s: %.1f seconds of %d × %d at %d frames a second, %s. Wrote %s, poster.png, " \
           "review/frame-01.png to frame-%02d.png." % (name, seconds, w, h, fps, weight, video_name, STILLS)


# --- Text on pictures (ffmpeg here cannot draw text) -------------------------------

def read_fontmap():
    try:
        with open(os.path.join(HERE, "fontmap.json"), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    out = {}
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(k, str) and isinstance(v, list):
                paths = [p for p in v if isinstance(p, str) and p.startswith("/System/Library/Fonts/")]
                out[k.lower()] = paths
    return out


def font(name, size):
    from PIL import ImageFont
    paths = read_fontmap().get((name or "").lower()) if name else None
    if paths is None and not name:
        maps = read_fontmap()
        paths = maps.get("helvetica neue") or next(iter(maps.values()), [])
    for p in paths or []:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def caption_picture(text, w, h, style=None):
    """A transparent picture of the video's size with the words in a dark band."""
    from PIL import Image, ImageDraw
    style = style or {}
    size = style.get("size") or max(14, min(96, h // 16))
    f = font(style.get("font"), size)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    max_w = int(w * 0.84)
    lines, line = [], ""
    for word in text.split():
        trial = (line + " " + word).strip()
        if d.textlength(trial, font=f) <= max_w or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    lines = lines[:3]
    gap = int(size * 0.25)
    heights = [d.textbbox((0, 0), l, font=f)[3] - d.textbbox((0, 0), l, font=f)[1] for l in lines]
    block_h = sum(heights) + gap * (len(lines) - 1)
    pad = int(size * 0.5)
    widest = max(d.textlength(l, font=f) for l in lines) if lines else 0
    top = int(h * 0.06) if style.get("position") == "top" else h - int(h * 0.08) - block_h - 2 * pad
    left = int((w - widest) / 2)
    d.rounded_rectangle([left - pad, top - pad // 2, left + widest + pad, top + block_h + pad * 3 // 2],
                        radius=pad, fill=(12, 12, 16, 178))
    y = top + pad // 2
    for l, lh in zip(lines, heights):
        x = int((w - d.textlength(l, font=f)) / 2)
        d.text((x, y - d.textbbox((0, 0), l, font=f)[1]), l, font=f, fill=(250, 250, 250, 255))
        y += lh + gap
    return im


def check_caption_style(style):
    if style is None:
        return {}
    if not isinstance(style, dict):
        raise Problem("`caption_style` must be {font, size, position}")
    extra = set(style) - {"font", "size", "position"}
    if extra:
        raise Problem("`caption_style` has keys it does not have: %s" % ", ".join(sorted(map(str, extra))))
    out = {}
    if "font" in style:
        if not isinstance(style["font"], str) or len(style["font"]) > 60:
            raise Problem("`caption_style.font` must be a typeface name from the brand file")
        out["font"] = style["font"]
    if "size" in style:
        if not whole(style["size"]) or not 12 <= style["size"] <= 120:
            raise Problem("`caption_style.size` must be a whole number of pixels from 12 to 120")
        out["size"] = style["size"]
    if "position" in style:
        if style["position"] not in ("bottom", "top"):
            raise Problem("`caption_style.position` must be bottom or top")
        out["position"] = style["position"]
    return out


# --- render: frames from an agent's script, in a child process ---------------------
# The child runs the script and writes, on its stdout: one JSON line (what the
# script left, or the problem), then for each frame b"F" and the raw RGB bytes,
# and at the end b"D", or b"E" + 4-byte length + the problem.

def child_frames(script):
    data = os.fdopen(os.dup(1), "wb", buffering=0)
    os.dup2(2, 1)                       # whatever the script prints goes to stderr
    sys.stdout = sys.stderr

    def problem_line(msg):
        data.write(json.dumps({"ok": False, "problem": msg}).encode("utf-8") + b"\n")

    def where():
        _, _, tb = sys.exc_info()
        line = None
        for frame, lineno in traceback.walk_tb(tb):
            if os.path.abspath(frame.f_code.co_filename) == script:
                line = lineno
        return " on line %d" % line if line else ""

    def failed(e):
        msg = str(e).strip().splitlines()[0] if str(e).strip() else ""
        return "the script failed%s: %s%s" % (where(), type(e).__name__, ": " + msg[:200] if msg else "")

    try:
        from PIL import Image
    except ImportError:
        problem_line("the drawing library is not installed; ask the owner to run engine/art/install.sh")
        return 0
    try:
        space = runpy.run_path(script, run_name="__main__")
    except SystemExit as e:
        problem_line("the script stopped itself (exit %s) before leaving any frames" % (e.code,))
        return 0
    except BaseException as e:
        problem_line(failed(e))
        return 0
    if "frames" not in space:
        problem_line("the script left no `frames` (Pillow images, a list or an iterator)")
        return 0
    frames = space["frames"]
    if isinstance(frames, (str, bytes, dict)) or isinstance(frames, Image.Image):
        problem_line("`frames` must be a list or an iterator of images")
        return 0
    count = len(frames) if isinstance(frames, (list, tuple)) else None
    try:
        it = iter(frames)
    except TypeError:
        problem_line("`frames` must be a list or an iterator of images")
        return 0
    size = space.get("size")
    if isinstance(size, tuple):
        size = list(size)
    head = {"ok": True, "size": size, "fps": space.get("fps"), "title": space.get("title"),
            "audio": space.get("audio"), "count": count}
    try:
        data.write(json.dumps(head).encode("utf-8") + b"\n")
    except (TypeError, ValueError):
        problem_line("`size`, `fps`, `title` and `audio` must be plain numbers and text")
        return 0
    try:
        w, h = size
    except (TypeError, ValueError):
        return 0                        # the parent refuses the size
    i = 0
    try:
        for im in it:
            if not isinstance(im, Image.Image):
                raise Problem("frame %d is a %s, not an image" % (i, type(im).__name__))
            if im.size != (w, h):
                raise Problem("frame %d is %d × %d but `size` is %d × %d" % (i, im.size[0], im.size[1], w, h))
            data.write(b"F" + im.convert("RGB").tobytes())
            i += 1
    except BrokenPipeError:
        return 0
    except Problem as e:
        msg = str(e).encode("utf-8")
        data.write(b"E" + struct.pack(">I", len(msg)) + msg)
        return 0
    except BaseException as e:
        msg = failed(e).encode("utf-8")
        try:
            data.write(b"E" + struct.pack(">I", len(msg)) + msg)
        except BrokenPipeError:
            pass
        return 0
    data.write(b"D")
    return 0


def read_exact(fh, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = fh.read(n - len(buf))
        if not chunk:
            break
        buf += chunk
    return bytes(buf)


def read_head(fh):
    line = fh.readline(64 * 1024)
    if not line.endswith(b"\n"):
        raise Problem("the script left nothing the helper could read")
    try:
        head = json.loads(line.decode("utf-8"))
    except ValueError:
        raise Problem("the script left nothing the helper could read")
    if not isinstance(head, dict):
        raise Problem("the script left nothing the helper could read")
    return head


def read_frame(fh, nbytes):
    tag = fh.read(1)
    if tag == b"F":
        data = read_exact(fh, nbytes)
        if len(data) != nbytes:
            raise Problem("the script stopped in the middle of a frame")
        return data
    if tag == b"D":
        return None
    if tag == b"E":
        n = struct.unpack(">I", read_exact(fh, 4) or b"\0\0\0\0")[0]
        raise Problem(read_exact(fh, min(n, 1000)).decode("utf-8", "replace"))
    raise Problem("the script stopped before it finished its frames")


def cmd_render(args, cwd, goal):
    if len(args) != 1:
        raise Problem("give one script, for example: video.py render title.py")
    name = plain_name(args[0], (".py",), "script")
    script = os.path.join(cwd, args[0])
    if not os.path.isfile(script):
        raise Problem("there is no script named %s here" % args[0])
    ffmpeg, ffprobe = runnable("UUU_FFMPEG"), runnable("UUU_FFPROBE")
    check_free(free_bytes_at(cwd))
    cap = output_cap(goal)

    child = start([sys.executable, "-E", os.path.abspath(__file__), "--frames-from", os.path.abspath(script)],
                  cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE)
    fh = child.stdout
    head = read_head(fh)
    if not head.get("ok"):
        raise Problem(str(head.get("problem", "the script failed"))[:400])
    if head.get("size") is None:
        raise Problem("the script left no `size` (width, height)")
    w, h = check_size(head.get("size"))
    if head.get("fps") is None:
        raise Problem("the script left no `fps`")
    fps = check_fps(head.get("fps"))
    title = check_title(head.get("title"), name)
    max_frames = fps * MAX_SECONDS
    count = head.get("count")
    if count is not None:
        if count < 1:
            raise Problem("`frames` is empty")
        if count > max_frames:
            raise Problem("the frames last %.1f seconds; at most %d seconds is allowed"
                          % (count / float(fps), MAX_SECONDS))
    audio = None
    if head.get("audio") is not None:
        audio = find_input(head.get("audio"), cwd, goal, SOUND_ENDINGS + CLIP_ENDINGS, "sound",
                           MAX_SOURCE_BYTES)
        if not check_source(audio, ffprobe, need_video=False)["audio"]:
            raise Problem("the sound file has no sound in it")

    nbytes = w * h * 3
    first = read_frame(fh, nbytes)      # a bad first frame is refused before ffmpeg starts
    if first is None:
        raise Problem("`frames` is empty")

    tmp = temp_path(cwd, name, ".mp4")
    errf = tempfile.TemporaryFile()
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostats", "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (w, h), "-r", str(fps), "-i", "pipe:0"]
    if audio:
        cmd += ["-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "160k", "-shortest"]
    cmd += x264_args(cap) + [tmp]
    enc = start(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errf)
    n = 0
    frame = first
    try:
        while frame is not None:
            n += 1
            if n > max_frames:
                raise Problem("the frames last more than %d seconds; at most %d seconds is allowed"
                              % (MAX_SECONDS, MAX_SECONDS))
            remaining()
            enc.stdin.write(frame)
            frame = read_frame(fh, nbytes)
        enc.stdin.close()
    except BrokenPipeError:
        enc.wait(timeout=30)
        errf.seek(0)
        raise Problem("ffmpeg stopped: %s" % last_line(errf.read()))
    try:
        enc.wait(timeout=remaining())
    except subprocess.TimeoutExpired:
        raise Problem("the work took longer than 10 minutes and was stopped")
    if enc.returncode != 0:
        errf.seek(0)
        raise Problem("ffmpeg failed: %s" % last_line(errf.read()))
    child.wait(timeout=30)
    return finish(cwd, name, tmp, title, "render", args[0], w, h, fps, n / float(fps), ffmpeg, ffprobe)


# --- reveal: slow moves over pictures, crossfades, captions -------------------------

def load_picture(path):
    from PIL import Image
    import warnings
    Image.MAX_IMAGE_PIXELS = MAX_PICTURE_PIXELS
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(path) as im:
                if im.width * im.height > MAX_PICTURE_PIXELS:
                    raise Problem("a picture is larger than 50 million pixels")
                return im.convert("RGB")
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise Problem("a picture is larger than 50 million pixels")
        except OSError:
            raise Problem("the picture %s could not be opened" % os.path.basename(path))


def cover(pic, w, h):
    """The scale at which the picture just covers w x h."""
    return max(w / float(pic.width), h / float(pic.height))


def shot_frame(pic, w, h, move, t):
    """One frame of a shot at progress t (0..1): a crop box that moves, resized."""
    from PIL import Image
    base = cover(pic, w, h)
    zoom = 1.0
    zmax = 1.12
    if move == "in":
        zoom = 1.0 + (zmax - 1.0) * t
    elif move == "out":
        zoom = zmax - (zmax - 1.0) * t
    elif move in ("left", "right"):
        zoom = zmax
    cw, ch = w / (base * zoom), h / (base * zoom)
    cx, cy = pic.width / 2.0, pic.height / 2.0
    if move in ("left", "right"):
        span = pic.width - cw
        cx = cw / 2.0 + span * (t if move == "right" else 1.0 - t)
    box = (cx - cw / 2.0, cy - ch / 2.0, cx + cw / 2.0, cy + ch / 2.0)
    return pic.resize((w, h), Image.BILINEAR, box=box)


def check_reveal(spec, cwd, goal, name):
    if not isinstance(spec, dict):
        raise Problem("the reveal must be {size, fps, shots}")
    extra = set(spec) - {"size", "fps", "shots", "title", "caption_style"}
    if extra:
        raise Problem("the reveal has keys it does not have: %s" % ", ".join(sorted(map(str, extra))))
    w, h = check_size(spec.get("size"))
    fps = check_fps(spec.get("fps"))
    title = check_title(spec.get("title"), name)
    style = check_caption_style(spec.get("caption_style"))
    shots = spec.get("shots")
    if not isinstance(shots, list) or not 1 <= len(shots) <= MAX_SHOTS:
        raise Problem("`shots` must be a list of 1 to %d pictures" % MAX_SHOTS)
    out, total = [], 0.0
    for i, s in enumerate(shots):
        if not isinstance(s, dict):
            raise Problem("shot %d must be {image, seconds, move, caption}" % (i + 1))
        extra = set(s) - {"image", "seconds", "move", "caption"}
        if extra:
            raise Problem("shot %d has keys a shot does not have: %s" % (i + 1, ", ".join(sorted(map(str, extra)))))
        sec = s.get("seconds")
        if not number(sec) or not 0.5 <= sec <= MAX_SECONDS:
            raise Problem("shot %d needs `seconds` from 0.5 to %d" % (i + 1, MAX_SECONDS))
        move = s.get("move", "still")
        if move not in MOVES:
            raise Problem("shot %d has move %s; use in, out, left, right or still"
                          % (i + 1, json.dumps(move) if isinstance(move, str) else "?"))
        cap = s.get("caption")
        if cap is not None:
            if not isinstance(cap, str) or len(cap) > MAX_CAPTION or "\n" in cap.strip():
                raise Problem("the caption of shot %d must be one line of at most %d characters"
                              % (i + 1, MAX_CAPTION))
            cap = " ".join(cap.split()) or None
        path = find_input(s.get("image"), cwd, goal, PICTURE_ENDINGS, "picture", MAX_PICTURE_BYTES)
        total += sec
        out.append({"path": path, "seconds": float(sec), "move": move, "caption": cap})
    fade = 0.5 if len(out) > 1 else 0.0
    seconds = total - fade * (len(out) - 1)
    if seconds > MAX_SECONDS:
        raise Problem("the shots last %.1f seconds; at most %d seconds is allowed" % (seconds, MAX_SECONDS))
    return w, h, fps, title, style, out, fade


def reveal_frames(w, h, fps, style, shots, fade):
    from PIL import Image
    pics = []
    for s in shots:
        pic = load_picture(s["path"])
        cap = caption_picture(s["caption"], w, h, style) if s["caption"] else None
        pics.append((pic, cap))
    starts, t = [], 0.0
    for s in shots:
        starts.append(t)
        t += s["seconds"] - fade
    total = t + fade
    n = int(round(total * fps))
    for k in range(n):
        at = k / float(fps)
        frame = None
        for i, s in enumerate(shots):
            a, b = starts[i], starts[i] + s["seconds"]
            if not a <= at < b:
                continue
            pic, cap = pics[i]
            im = shot_frame(pic, w, h, s["move"], (at - a) / s["seconds"])
            if cap is not None:
                im = Image.alpha_composite(im.convert("RGBA"), cap).convert("RGB")
            if frame is None:
                frame = im
            else:   # the crossfade: this shot comes in over the one before
                frame = Image.blend(frame, im, min(1.0, (at - a) / fade) if fade else 1.0)
        if frame is None:
            frame = Image.new("RGB", (w, h), (0, 0, 0))
        yield frame


def cmd_reveal(args, cwd, goal):
    if len(args) != 1:
        raise Problem("give one reveal file, for example: video.py reveal tour.json")
    name = plain_name(args[0], (".json",), "reveal file")
    spec = read_json_file(args[0], cwd, "reveal file")
    w, h, fps, title, style, shots, fade = check_reveal(spec, cwd, goal, name)
    ffmpeg, ffprobe = runnable("UUU_FFMPEG"), runnable("UUU_FFPROBE")
    check_free(free_bytes_at(cwd))
    cap = output_cap(goal)
    frames = reveal_frames(w, h, fps, style, shots, fade)
    first = next(frames)
    tmp = temp_path(cwd, name, ".mp4")
    errf = tempfile.TemporaryFile()
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostats", "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (w, h), "-r", str(fps), "-i", "pipe:0"]
    enc = start(cmd + x264_args(cap) + [tmp], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errf)
    n = 1
    try:
        enc.stdin.write(first.tobytes())
        for im in frames:
            n += 1
            if n > fps * MAX_SECONDS:
                raise Problem("the shots last more than %d seconds" % MAX_SECONDS)
            remaining()
            enc.stdin.write(im.tobytes())
        enc.stdin.close()
    except BrokenPipeError:
        enc.wait(timeout=30)
        errf.seek(0)
        raise Problem("ffmpeg stopped: %s" % last_line(errf.read()))
    try:
        enc.wait(timeout=remaining())
    except subprocess.TimeoutExpired:
        raise Problem("the work took longer than 10 minutes and was stopped")
    if enc.returncode != 0:
        errf.seek(0)
        raise Problem("ffmpeg failed: %s" % last_line(errf.read()))
    return finish(cwd, name, tmp, title, "reveal", args[0], w, h, fps, n / float(fps), ffmpeg, ffprobe)


# --- words: speech to text -----------------------------------------------------------

def read_words(path):
    """[{"w", "from", "to"}] from a words.json, checked."""
    if os.path.getsize(path) > MAX_JSON_BYTES:
        raise Problem("words.json is larger than 2 MB")
    try:
        with open(path, "rb") as fh:
            words = json.loads(fh.read().decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise Problem("words.json is not valid JSON")
    if not isinstance(words, list) or len(words) > MAX_WORDS:
        raise Problem("words.json must be a list of at most %d words" % MAX_WORDS)
    out = []
    for i, x in enumerate(words):
        if not isinstance(x, dict) or not isinstance(x.get("w"), str) \
                or not number(x.get("from")) or not number(x.get("to")) \
                or not 0 <= x["from"] <= x["to"] or len(x["w"]) > 100:
            raise Problem("word %d in words.json must be {w, from, to} with from <= to" % (i + 1))
        out.append({"w": x["w"], "from": float(x["from"]), "to": float(x["to"])})
    out.sort(key=lambda x: x["from"])
    return out


def whisper_words(data):
    """Words from whisper-cli's JSON (-ml 1 -sow -oj): one segment per word."""
    out = []
    for seg in data.get("transcription", []) if isinstance(data, dict) else []:
        if not isinstance(seg, dict):
            continue
        text = seg.get("text")
        off = seg.get("offsets") or {}
        if not isinstance(text, str) or not number(off.get("from")) or not number(off.get("to")):
            continue
        word = text.strip()
        if not word or (word.startswith("[") and word.endswith("]")) or (word.startswith("(") and word.endswith(")")):
            continue
        out.append({"w": word[:100], "from": round(off["from"] / 1000.0, 2), "to": round(off["to"] / 1000.0, 2)})
        if len(out) >= MAX_WORDS:
            break
    return out


def cmd_words(args, cwd, goal):
    if len(args) != 1:
        raise Problem("give one clip, for example: video.py words site-visit.mp4")
    ffmpeg, ffprobe = runnable("UUU_FFMPEG"), runnable("UUU_FFPROBE")
    stt = runnable("UUU_STT")
    model = tool("UUU_STT_MODEL")
    check_free(free_bytes_at(cwd))
    output_cap(goal)
    clip = find_input(args[0], cwd, goal, CLIP_ENDINGS + SOUND_ENDINGS, "clip", MAX_SOURCE_BYTES)
    info = check_source(clip, ffprobe, need_video=False)
    if not info["audio"]:
        raise Problem("the clip has no sound, so there are no words to take out")
    wav = temp_path(cwd, "words", ".wav")
    base = temp_path(cwd, "words", "")
    TEMPS.append(base + ".json")
    run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", clip, "-vn",
         "-ar", "16000", "-ac", "1", "-t", str(MAX_SOURCE_SECONDS), "-fs", str(50 * MB), wav],
        "taking the sound out of the clip")
    run([stt, "-ng", "-t", "6", "-m", model, "-f", wav, "-ml", "1", "-sow", "-oj", "-of", base],
        "speech to text")
    try:
        with open(base + ".json", "rb") as fh:
            data = json.loads(fh.read(20 * MB).decode("utf-8", "replace"))
    except (OSError, ValueError):
        raise Problem("speech to text wrote no words")
    words = whisper_words(data)
    write_atomic(os.path.join(cwd, "words.json"), json_bytes(words))
    return "words: %s from %.1f seconds of %s. Wrote words.json." % (
        plural(len(words), "word"), info["duration"], os.path.basename(clip))


# --- cut: an edit list, never inside a word -------------------------------------------

def snap_ranges(keep, words, duration):
    """Moves every edge that falls inside a word to that word's edge (the whole
    word is kept), clamps to the clip, sorts and joins overlaps."""
    out = []
    for a, b in keep:
        for x in words:
            if x["from"] < a < x["to"]:
                a = x["from"]
            if x["from"] < b < x["to"]:
                b = x["to"]
        a, b = max(0.0, a), min(duration, b)
        if b - a >= 0.05:
            out.append([a, b])
    out.sort()
    joined = []
    for a, b in out:
        if joined and a <= joined[-1][1] + 1e-6:
            joined[-1][1] = max(joined[-1][1], b)
        else:
            joined.append([a, b])
    return [[round(a, 3), round(b, 3)] for a, b in joined]


def caption_lines(words, keep):
    """Words moved onto the cut's timeline, grouped into short lines."""
    placed, offset = [], 0.0
    for a, b in keep:
        for x in words:
            if x["from"] >= a - 1e-6 and x["to"] <= b + 1e-6:
                placed.append((offset + x["from"] - a, offset + x["to"] - a, x["w"]))
        offset += b - a
    lines, cur = [], []
    for s, e, w in placed:
        if cur and (len(cur) >= 7 or e - cur[0][0] > 3.5 or s - cur[-1][1] > 0.6
                    or len(" ".join(c[2] for c in cur) + " " + w) > 42):
            lines.append(cur)
            cur = []
        cur.append((s, e, w))
    if cur:
        lines.append(cur)
    return [(l[0][0], l[-1][1], " ".join(c[2] for c in l)) for l in lines]


def cmd_cut(args, cwd, goal):
    if len(args) != 1:
        raise Problem("give one edit list, for example: video.py cut short.json")
    name = plain_name(args[0], (".json",), "edit list")
    spec = read_json_file(args[0], cwd, "edit list")
    if not isinstance(spec, dict):
        raise Problem("the edit list must be {source, keep, captions}")
    extra = set(spec) - {"source", "keep", "captions", "caption_style", "title"}
    if extra:
        raise Problem("the edit list has keys it does not have: %s" % ", ".join(sorted(map(str, extra))))
    title = check_title(spec.get("title"), name)
    style = check_caption_style(spec.get("caption_style"))
    keep = spec.get("keep")
    if not isinstance(keep, list) or not 1 <= len(keep) <= MAX_KEEP:
        raise Problem("`keep` must be a list of 1 to %d [from, to] pairs in seconds" % MAX_KEEP)
    for i, r in enumerate(keep):
        if not isinstance(r, list) or len(r) != 2 or not all(number(x) for x in r) or not 0 <= r[0] < r[1]:
            raise Problem("keep %d must be [from, to] in seconds, with from before to" % (i + 1))
    words = None
    caps = spec.get("captions")
    if caps is not None:
        if caps != "words.json":
            raise Problem("`captions` must be \"words.json\" or null")
        wpath = os.path.join(cwd, "words.json")
        if not os.path.isfile(wpath):
            raise Problem("there is no words.json here; run: video.py words <clip>")
        words = read_words(wpath)
    elif os.path.isfile(os.path.join(cwd, "words.json")):
        words = read_words(os.path.join(cwd, "words.json"))   # cuts still keep whole words
    ffmpeg, ffprobe = runnable("UUU_FFMPEG"), runnable("UUU_FFPROBE")
    source = find_input(spec.get("source"), cwd, goal, CLIP_ENDINGS, "clip", MAX_SOURCE_BYTES)
    info = check_source(source, ffprobe)
    check_free(free_bytes_at(cwd))
    cap = output_cap(goal)

    for i, r in enumerate(keep):
        if r[0] >= info["duration"]:
            raise Problem("keep %d starts after the clip ends (%.1f seconds)" % (i + 1, info["duration"]))
    ranges = snap_ranges([(float(a), float(b)) for a, b in keep], words or [], info["duration"])
    if not ranges:
        raise Problem("nothing is left to keep")
    total = sum(b - a for a, b in ranges)
    if total > MAX_SECONDS:
        raise Problem("the cut lasts %.1f seconds; at most %d seconds is allowed" % (total, MAX_SECONDS))
    v = info["video"]
    w, h = fit(int(v.get("width") or 0) or 2, int(v.get("height") or 0) or 2)
    fps = int(round(info["fps"])) if info["fps"] else 30
    fps = max(1, min(MAX_FPS, fps))
    lines = caption_lines(words, ranges) if caps is not None else []
    if len(lines) > MAX_CAPTIONS:
        raise Problem("the cut would have %d captions; at most %d. Keep less of the clip"
                      % (len(lines), MAX_CAPTIONS))

    has_audio = bool(info["audio"])
    parts = []
    for i, (a, b) in enumerate(ranges):
        parts.append("[0:v]trim=start=%.3f:end=%.3f,setpts=PTS-STARTPTS[v%d]" % (a, b, i))
        if has_audio:
            parts.append("[0:a]atrim=start=%.3f:end=%.3f,asetpts=PTS-STARTPTS[a%d]" % (a, b, i))
    joined = "".join("[v%d]%s" % (i, "[a%d]" % i if has_audio else "") for i in range(len(ranges)))
    parts.append("%sconcat=n=%d:v=1:a=%d[vc]%s" % (joined, len(ranges), 1 if has_audio else 0,
                                                   "[ac]" if has_audio else ""))
    parts.append("[vc]scale=%d:%d,fps=%d,format=yuv420p[s0]" % (w, h, fps))
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostats", "-nostdin", "-y", "-i", source]
    last = "s0"
    if lines:
        cdir = temp_path(cwd, name + "-captions", "")
        os.mkdir(cdir)
        for i, (s, e, text) in enumerate(lines):
            p = os.path.join(cdir, "%03d.png" % i)
            caption_picture(text, w, h, style).save(p, "PNG")
            cmd += ["-i", p]
            parts.append("[%s][%d:v]overlay=0:0:enable='between(t,%.3f,%.3f)'[s%d]" % (last, i + 1, s, e, i + 1))
            last = "s%d" % (i + 1)
    tmp = temp_path(cwd, name, ".mp4")
    cmd += ["-filter_complex", ";".join(parts), "-map", "[%s]" % last]
    if has_audio:
        cmd += ["-map", "[ac]", "-c:a", "aac", "-b:a", "160k"]
    cmd += x264_args(cap) + [tmp]
    run(cmd, "ffmpeg")
    line = finish(cwd, name, tmp, title, "cut", args[0], w, h, fps, total, ffmpeg, ffprobe)
    return line[:-1] + "; kept %s of the clip." % plural(len(ranges), "part")


def cmd_stills(args, cwd, goal):
    if len(args) != 1:
        raise Problem("give one video, for example: video.py stills title.mp4")
    plain_name(args[0], (".mp4",), "video")
    path = os.path.join(cwd, args[0])
    if not os.path.isfile(path) or os.path.islink(path):
        raise Problem("there is no video named %s here" % args[0])
    if os.path.getsize(path) > MAX_OUTPUT_BYTES:
        raise Problem("the video is larger than 300 MB")
    ffmpeg, ffprobe = runnable("UUU_FFMPEG"), runnable("UUU_FFPROBE")
    check_free(free_bytes_at(cwd))
    output_cap(goal)
    info = probe(path, ffprobe)
    if not info["video"]:
        raise Problem("the video has no picture")
    write_stills(cwd, path, ffmpeg, ffprobe, info["duration"])
    return "%s: wrote review/frame-01.png to frame-%02d.png." % (args[0][:-4], STILLS)


COMMANDS = {"render": cmd_render, "reveal": cmd_reveal, "words": cmd_words, "cut": cmd_cut, "stills": cmd_stills}


def main(argv):
    if len(argv) == 2 and argv[0] == "--frames-from":
        return child_frames(argv[1])
    if not argv or argv[0] not in COMMANDS:
        sys.stderr.write("video: give a command: render <name>.py, reveal <name>.json, words <clip>, "
                         "cut <name>.json or stills <name>.mp4\n")
        return 1
    try:
        hold_limits()
        cwd = os.path.realpath(os.getcwd())
        line = COMMANDS[argv[0]](argv[1:], cwd, goal_folder(cwd))
    except Problem as e:
        stop_children()
        remove_temps()
        sys.stderr.write("video: %s\n" % " ".join(str(e).split())[:500])
        return 1
    except Exception as e:   # Pillow or the system failed; still one line
        stop_children()
        remove_temps()
        msg = str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__
        sys.stderr.write("video: the video could not be made: %s\n" % msg[:200])
        return 1
    stop_children()
    remove_temps()
    sys.stdout.write(line + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
