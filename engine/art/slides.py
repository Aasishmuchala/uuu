#!/usr/bin/env python3
"""Turns one layout script into a carousel: its slides, a contact sheet and their words.

SAFETY: this runs code an agent wrote. Run it only inside the fence, in the
Artist's task folder, the way the Artist does:

    cd <goal>/slides/<name> && "$UUU_ART_PYTHON" "$UUU_ART_SLIDES" <name>.py

Never run it on an agent's script outside the fence, and never from the home
server: the home server only lists, checks and serves the files this writes.

    slides.py <name>.py

The script is given `font(name, size, bold=False)`: a typeface named in the
brand file (fontmap.json, beside this tool) at a size in pixels, or Pillow's
own font when the name is not in the map or its file is not on this Mac.

It leaves, by name (CONTRACTS-V3 36.2):
  slides     a list of 2 to 10 Pillow images, all 1080 x 1350 or all 1080 x 1080
  texts      a list of the words on each slide, one plain string per slide,
             each at most 600 characters
  title      optional: default the name
  sources    optional: the names of the company's pictures used

Writes beside the script:
  slide-01.png ...   one picture per slide
  contact.png        every slide side by side, at most 2160 pixels wide
  slides.json        {"slides": [{"file", "w", "h", "text"}]}
  manifest.json      what the home server lists

Everything is checked before anything is written; after writing, every picture
is opened again and checked. Prints one plain line, such as
  launch: 5 slides of 1080 × 1350. Wrote slide-01.png to slide-05.png, contact.png, slides.json.
On a problem it prints one plain line starting `slides:` and exits 1.

Installed by engine/art/install.sh as state/art/tools/slides.py, with
fontmap.json beside it, and run with the Artist's own Python (state/art/venv).
Standard library and Pillow only.
"""
import datetime
import io
import json
import os
import re
import runpy
import sys
import traceback

NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
SLIDE_FILE = re.compile(r"^slide-\d\d\.png$")
MIN_SLIDES = 2
MAX_SLIDES = 10
SIZES = ((1080, 1350), (1080, 1080))
MAX_TEXT = 600
MAX_TITLE = 120
MAX_SOURCES = 20
MAX_SOURCE = 200
CONTACT_WIDTH = 2160
MAX_FONT_SIZE = 1000
MAX_FACES = 32                  # faces looked at in one font collection


class Problem(Exception):
    pass


def plural(n, one, many=None):
    return "%d %s" % (n, one if n == 1 else (many or one + "s"))


def whole(x):
    return isinstance(x, int) and not isinstance(x, bool)


# --- Fonts ---------------------------------------------------------------------

def read_fontmap():
    """{lower-case name: (name, [paths])} from fontmap.json beside this tool; {} when unreadable."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fontmap.json")
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError):
        return {}
    out = {}
    if isinstance(raw, dict):
        for name, paths in raw.items():
            if isinstance(name, str) and isinstance(paths, list):
                paths = [p for p in paths if isinstance(p, str) and os.path.isabs(p)]
                out[" ".join(name.lower().split())] = (name, paths)
    return out


class Fonts:
    """The `font` helper the script is given, and a note of every name that fell back."""

    def __init__(self, fontmap):
        self.map = fontmap
        self.faces = {}          # path -> [(index, style)]
        self.fell_back = []

    def faces_of(self, path):
        from PIL import ImageFont

        if path not in self.faces:
            found = []
            for i in range(MAX_FACES):
                try:
                    f = ImageFont.truetype(path, 10, index=i)
                except (OSError, ValueError):
                    break
                found.append((i, (f.getname()[1] or "").strip().lower()))
                if not path.lower().endswith((".ttc", ".otc")):
                    break
            self.faces[path] = found
        return self.faces[path]

    def pick(self, paths, bold):
        """(path, index) of the face that fits best, or None when no file can be read."""
        want = ("bold",) if bold else ("regular", "roman", "book", "medium")
        first = None
        for path in paths:
            faces = self.faces_of(path)
            if not faces:
                continue
            if first is None:
                first = (path, faces[0][0])
            for style in want:
                for index, s in faces:
                    if s == style:
                        return path, index
        return first

    def fallback(self, size):
        from PIL import ImageFont

        try:
            return ImageFont.load_default(size=size)
        except (TypeError, OSError, ImportError, AttributeError):
            return ImageFont.load_default()

    def __call__(self, name, size, bold=False):
        from PIL import ImageFont

        if not whole(size) or not 1 <= size <= MAX_FONT_SIZE:
            raise ValueError("font size must be a whole number of pixels from 1 to %d" % MAX_FONT_SIZE)
        key = " ".join(name.lower().split()) if isinstance(name, str) else ""
        entry = self.map.get(key)
        choice = self.pick(entry[1], bool(bold)) if entry else None
        if choice:
            try:
                return ImageFont.truetype(choice[0], size, index=choice[1])
            except (OSError, ValueError):
                pass
        label = name if isinstance(name, str) else type(name).__name__
        label = " ".join(label.split())[:60]
        if label not in self.fell_back:
            self.fell_back.append(label)
        return self.fallback(size)


# --- Running the script --------------------------------------------------------

def where_in_script(script):
    """The line of the script where the last error happened, or None."""
    _, _, tb = sys.exc_info()
    line = None
    for frame, lineno in traceback.walk_tb(tb):
        if os.path.abspath(frame.f_code.co_filename) == script:
            line = lineno
    return line


def run_script(script, fonts):
    # Whatever the script prints goes to stderr, so the one plain line stays last.
    saved = sys.stdout
    sys.stdout = sys.stderr
    try:
        return runpy.run_path(script, init_globals={"font": fonts}, run_name="__main__")
    except SystemExit as e:
        raise Problem("the script stopped itself (exit %s) before leaving any slides" % (e.code,))
    except BaseException as e:   # the script's own error, shown in one line
        line = where_in_script(script)
        at = " on line %d" % line if line else ""
        msg = str(e).strip().splitlines()[0] if str(e).strip() else ""
        raise Problem("the script failed%s: %s%s" % (at, type(e).__name__, ": " + msg[:200] if msg else ""))
    finally:
        sys.stdout = saved


# --- Checks --------------------------------------------------------------------

def check_title(space, name):
    title = space.get("title", name)
    if not isinstance(title, str) or not title.strip():
        raise Problem("`title` must be a short line of text")
    title = " ".join(title.split())
    if len(title) > MAX_TITLE:
        raise Problem("`title` is longer than %d characters" % MAX_TITLE)
    return title


def check_slides(space):
    from PIL import Image

    slides = space["slides"]
    if not isinstance(slides, (list, tuple)):
        raise Problem("`slides` must be a list of images")
    if not MIN_SLIDES <= len(slides) <= MAX_SLIDES:
        raise Problem("`slides` must hold %d to %d images (it holds %d)" % (MIN_SLIDES, MAX_SLIDES, len(slides)))
    for i, im in enumerate(slides):
        if not isinstance(im, Image.Image):
            raise Problem("slide %d is a %s, not an image" % (i + 1, type(im).__name__))
    w, h = slides[0].size
    if (w, h) not in SIZES:
        raise Problem("slide 1 is %d × %d; every slide must be 1080 × 1350 or 1080 × 1080" % (w, h))
    for i, im in enumerate(slides):
        if im.size != (w, h):
            raise Problem("slide %d is %d × %d but slide 1 is %d × %d; every slide must be the same size"
                          % (i + 1, im.size[0], im.size[1], w, h))
    out = []
    for im in slides:
        if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
            flat = Image.new("RGB", (w, h), (255, 255, 255))
            flat.paste(im.convert("RGBA"), (0, 0), im.convert("RGBA"))
            out.append(flat)
        else:
            out.append(im.convert("RGB"))
    return out, w, h


def check_texts(space, n):
    if "texts" not in space:
        raise Problem("the script left no `texts`; leave a list with the words on each slide")
    texts = space["texts"]
    if not isinstance(texts, (list, tuple)):
        raise Problem("`texts` must be a list of strings, one per slide")
    if len(texts) != n:
        raise Problem("`texts` lists %d entries but there are %d slides" % (len(texts), n))
    for i, t in enumerate(texts):
        if not isinstance(t, str):
            raise Problem("the words of slide %d must be a string" % (i + 1))
        if len(t) > MAX_TEXT:
            raise Problem("the words of slide %d are %d characters; keep each at most %d"
                          % (i + 1, len(t), MAX_TEXT))
    return list(texts)


def check_sources(space):
    if "sources" not in space:
        return None
    sources = space["sources"]
    if not isinstance(sources, (list, tuple)) or len(sources) > MAX_SOURCES:
        raise Problem("`sources` must be a list of at most %d picture names" % MAX_SOURCES)
    out = []
    for i, s in enumerate(sources):
        if (not isinstance(s, str) or not s.strip() or len(s) > MAX_SOURCE
                or any(ord(c) < 32 or ord(c) == 127 for c in s)):
            raise Problem("source %d must be a picture's name on one line, at most %d characters"
                          % (i + 1, MAX_SOURCE))
        out.append(s.strip())
    return out


# --- Writing -------------------------------------------------------------------

def write_atomic(path, data):
    tmp = "%s.%d.tmp" % (path, os.getpid())
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(tmp, flags, 0o644)
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.lexists(tmp):
            os.remove(tmp)


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def json_bytes(obj):
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def contact_sheet(slides, w, h):
    from PIL import Image

    n = len(slides)
    tw = min(w, CONTACT_WIDTH // n)
    th = max(1, int(round(h * tw / float(w))))
    sheet = Image.new("RGB", (n * tw, th), (255, 255, 255))
    for i, im in enumerate(slides):
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (i * tw, 0))
    return sheet


def make(script_arg):
    if not script_arg.endswith(".py"):
        raise Problem("give the script's file name, ending in .py")
    script = os.path.abspath(script_arg)
    folder, base = os.path.split(script)
    name = base[:-3]
    if not NAME.match(name):
        raise Problem("the script's name may only use a to z, 0 to 9 and -, and start with a letter "
                      "or digit, at most 40 characters (got %r)" % base)
    if not os.path.isfile(script):
        raise Problem("there is no script named %s here" % base)
    try:
        from PIL import Image
    except ImportError:
        raise Problem("the drawing library is not installed; run engine/art/install.sh")

    fonts = Fonts(read_fontmap())
    space = run_script(script, fonts)
    if "slides" not in space:
        raise Problem("the script left no `slides` (a list of 2 to %d images)" % MAX_SLIDES)
    slides, w, h = check_slides(space)
    n = len(slides)
    texts = check_texts(space, n)
    title = check_title(space, name)
    sources = check_sources(space)

    files = ["slide-%02d.png" % (i + 1) for i in range(n)]
    slide_data = [png_bytes(im) for im in slides]
    contact = contact_sheet(slides, w, h)
    contact_data = png_bytes(contact)
    data = {"slides": [{"file": f, "w": w, "h": h, "text": t} for f, t in zip(files, texts)]}
    if sources is not None:
        data["sources"] = sources
    manifest = {
        "name": name, "title": title, "kind": "slides",
        "slides": files, "size": {"w": w, "h": h},
        "data": "slides.json", "contact": "contact.png",
        "script": base, "made_at": now(),
    }

    # Everything is checked and made; now write. The manifest goes last.
    for f, b in zip(files, slide_data):
        write_atomic(os.path.join(folder, f), b)
    write_atomic(os.path.join(folder, "contact.png"), contact_data)
    write_atomic(os.path.join(folder, "slides.json"), json_bytes(data))

    # Open what was written and check it again.
    for f in files:
        with Image.open(os.path.join(folder, f)) as im:
            if im.size != (w, h):
                raise Problem("%s on disk is not the size it should be" % f)
    with Image.open(os.path.join(folder, "contact.png")) as im:
        if im.size != contact.size or im.size[0] > CONTACT_WIDTH:
            raise Problem("contact.png on disk is not the size it should be")

    # Slides left from an earlier, longer run would be taken for this one's.
    for f in os.listdir(folder):
        if SLIDE_FILE.match(f) and f not in files:
            os.remove(os.path.join(folder, f))
    write_atomic(os.path.join(folder, "manifest.json"), json_bytes(manifest))

    wrote = "%s to %s" % (files[0], files[-1])
    line = "%s: %s of %d × %d. Wrote %s, contact.png, slides.json." % (name, plural(n, "slide"), w, h, wrote)
    if fonts.fell_back:
        line += " Pillow's own font stood in for: %s." % ", ".join(fonts.fell_back[:5])
    return line


def main(argv):
    if len(argv) != 1 or argv[0].startswith("-"):
        sys.stderr.write("slides: give one script, for example: slides.py launch.py\n")
        return 1
    try:
        line = make(argv[0])
    except Problem as e:
        sys.stderr.write("slides: %s\n" % e)
        return 1
    except Exception as e:   # Pillow itself failed; still one line
        msg = str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__
        sys.stderr.write("slides: the slides could not be made: %s\n" % msg[:200])
        return 1
    sys.stdout.write(line + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
