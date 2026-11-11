#!/usr/bin/env python3
"""Turns one drawing script into a sprite sheet, its frame data and a GIF.

SAFETY: this runs code an agent wrote. Run it only inside the fence, in the
Artist's task folder, the way the Artist does:

    cd <goal>/art/<name> && "$UUU_ART_PYTHON" "$UUU_ART_TOOL" <name>.py

Never run it on an agent's script outside the fence, and never from the home
server: the home server only lists, checks and serves the files this writes.

    sprite.py <name>.py [--frames]

Runs the script, which leaves, by name (CONTRACTS-V2 20.1):
  frames     a list of 1 to 256 Pillow images, all the same size, at most 512 x 512
  durations  optional: milliseconds, one whole number for all frames or a list
             (default 100; each 10 to 60000)
  tags       optional: a list of {"name", "from", "to", "direction"}
             (default one tag "all" over every frame, direction "forward")
  title      optional: default the name
  columns    optional: frames per row of the sheet (default all in one row)
or, for a simple vector image, `svg` (a string) instead of `frames`.

Writes beside the script (CONTRACTS-V2 20.2):
  <name>-sheet.png   every frame, left to right, then top to bottom
  <name>.json        the frame data, in Aseprite's json-array shape
  <name>.gif         every frame in order with its duration, looping
  manifest.json      what the home server lists
  frames/<name>-<NN>.png   one file per frame, only with --frames
For `svg`: <name>.svg and manifest.json.

Everything is checked before anything is written; after writing, the sheet and
the GIF are opened again and checked. Prints one plain line, such as
  walker: 4 frames of 16 × 16, 1 tag, 5 colours. Wrote walker-sheet.png, walker.json, walker.gif.
On a problem it prints one plain line starting `sprite:` and exits 1.

Installed by engine/art/install.sh as state/art/tools/sprite.py and run with the
Artist's own Python (state/art/venv). Standard library and Pillow only.
"""
import datetime
import io
import json
import os
import re
import runpy
import struct
import sys
import traceback

NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
MAX_FRAMES = 256
MAX_FRAME_SIDE = 512
MAX_SHEET_SIDE = 16384          # the home server reads no number above this
MAX_SVG_BYTES = 1024 * 1024
MAX_TITLE = 120
MAX_TAG_NAME = 60
DIRECTIONS = ("forward", "reverse", "pingpong")
PALETTE_MAX = 64


class Problem(Exception):
    pass


def plural(n, one, many=None):
    return "%d %s" % (n, one if n == 1 else (many or one + "s"))


def where_in_script(script):
    """The line of the script where the last error happened, or None."""
    _, _, tb = sys.exc_info()
    line = None
    for frame, lineno in traceback.walk_tb(tb):
        if os.path.abspath(frame.f_code.co_filename) == script:
            line = lineno
    return line


def run_script(script):
    # Whatever the script prints goes to stderr, so the one plain line stays last.
    saved = sys.stdout
    sys.stdout = sys.stderr
    try:
        return runpy.run_path(script, run_name="__main__")
    except SystemExit as e:
        raise Problem("the script stopped itself (exit %s) before leaving any frames" % (e.code,))
    except BaseException as e:   # the script's own error, shown in one line
        line = where_in_script(script)
        at = " on line %d" % line if line else ""
        msg = str(e).strip().splitlines()[0] if str(e).strip() else ""
        raise Problem("the script failed%s: %s%s" % (at, type(e).__name__, ": " + msg[:200] if msg else ""))
    finally:
        sys.stdout = saved


def whole(x):
    return isinstance(x, int) and not isinstance(x, bool)


def check_title(space, name):
    title = space.get("title", name)
    if not isinstance(title, str) or not title.strip():
        raise Problem("`title` must be a short line of text")
    title = " ".join(title.split())
    if len(title) > MAX_TITLE:
        raise Problem("`title` is longer than %d characters" % MAX_TITLE)
    return title


def check_frames(space):
    from PIL import Image

    frames = space["frames"]
    if not isinstance(frames, (list, tuple)):
        raise Problem("`frames` must be a list of images")
    if not 1 <= len(frames) <= MAX_FRAMES:
        raise Problem("`frames` must hold 1 to %d images (it holds %d)" % (MAX_FRAMES, len(frames)))
    for i, im in enumerate(frames):
        if not isinstance(im, Image.Image):
            raise Problem("frame %d is a %s, not an image" % (i, type(im).__name__))
    w, h = frames[0].size
    for i, im in enumerate(frames):
        if im.size != (w, h):
            raise Problem("frame %d is %d × %d but frame 0 is %d × %d; every frame must be the same size"
                          % (i, im.size[0], im.size[1], w, h))
    if not (1 <= w <= MAX_FRAME_SIDE and 1 <= h <= MAX_FRAME_SIDE):
        raise Problem("frames are %d × %d; each side must be 1 to %d pixels" % (w, h, MAX_FRAME_SIDE))
    return [im.convert("RGBA") for im in frames], w, h


def check_durations(space, n):
    d = space.get("durations", 100)
    if whole(d):
        d = [d] * n
    elif isinstance(d, (list, tuple)):
        d = list(d)
        if len(d) != n:
            raise Problem("`durations` lists %d numbers but there are %d frames" % (len(d), n))
    else:
        raise Problem("`durations` must be one whole number of milliseconds or a list of them")
    for i, x in enumerate(d):
        if not whole(x) or not 10 <= x <= 60000:
            raise Problem("the duration of frame %d must be a whole number of milliseconds from 10 to 60000" % i)
    return d


def check_tags(space, n):
    if "tags" not in space:
        return [{"name": "all", "from": 0, "to": n - 1, "direction": "forward"}]
    tags = space["tags"]
    if not isinstance(tags, (list, tuple)):
        raise Problem("`tags` must be a list of {name, from, to, direction}")
    out = []
    for i, t in enumerate(tags):
        if not isinstance(t, dict):
            raise Problem("tag %d must be {name, from, to, direction}" % i)
        extra = set(t) - {"name", "from", "to", "direction"}
        if extra:
            raise Problem("tag %d has keys a tag does not have: %s" % (i, ", ".join(sorted(map(str, extra)))))
        name = t.get("name")
        if not isinstance(name, str) or not name.strip() or len(name) > MAX_TAG_NAME or "\n" in name:
            raise Problem("tag %d needs a short name" % i)
        a, b = t.get("from"), t.get("to")
        if not whole(a) or not whole(b) or not 0 <= a <= b < n:
            raise Problem("tag %s must have 0 <= from <= to < %d (the number of frames)" % (json.dumps(name), n))
        direction = t.get("direction", "forward")
        if direction not in DIRECTIONS:
            raise Problem("tag %s has direction %s; use forward, reverse or pingpong"
                          % (json.dumps(name), json.dumps(direction) if isinstance(direction, str) else "?"))
        out.append({"name": name, "from": a, "to": b, "direction": direction})
    return out


def check_columns(space, n, w, h):
    cols = space.get("columns", n)
    if not whole(cols) or not 1 <= cols <= n:
        raise Problem("`columns` must be a whole number from 1 to %d (the number of frames)" % n)
    rows = (n + cols - 1) // cols
    if cols * w > MAX_SHEET_SIDE or rows * h > MAX_SHEET_SIDE:
        raise Problem("the sheet would be %d × %d; keep each side at most %d pixels (set `columns`)"
                      % (cols * w, rows * h, MAX_SHEET_SIDE))
    return cols, rows


SVG_HREF = re.compile(r"href\s*=\s*([\"']?)\s*(.?)", re.I)
SVG_ON = re.compile(r"[\s/\"']on[a-z0-9_.:-]*\s*=", re.I)


def check_svg(svg):
    if not isinstance(svg, str):
        raise Problem("`svg` must be a string holding the image")
    text = svg.strip()
    if len(text.encode("utf-8")) > MAX_SVG_BYTES:
        raise Problem("the image is larger than 1 MB")
    if not text.startswith("<svg"):
        raise Problem("the image must start with <svg")
    low = text.lower()
    if "<script" in low:
        raise Problem("the image holds a script; draw with shapes only")
    if "<foreignobject" in low:
        raise Problem("the image holds a foreignObject; draw with shapes only")
    if "<!" in low:
        raise Problem("the image holds a DOCTYPE, an entity or a CDATA block; leave them out")
    if SVG_ON.search(text):
        raise Problem("the image holds an attribute starting with on; leave event handlers out")
    for m in SVG_HREF.finditer(text):
        if m.group(2) != "#":
            raise Problem("the image links to something outside itself; an href may only point inside it (#...)")
    return text + "\n"


def write_atomic(path, data):
    tmp = "%s.%d.tmp" % (path, os.getpid())
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def json_bytes(obj):
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- The GIF -------------------------------------------------------------------
# Pillow merges frames that equal the one before into one longer frame, so a
# held pose would leave the GIF with fewer frames than the sheet. Each frame is
# therefore encoded on its own and the image blocks are joined here, one per
# frame, each with its own colour table and delay.

def _sub_blocks_end(b, i):
    while True:
        if i >= len(b):
            raise Problem("a GIF frame could not be encoded")
        size = b[i]
        i += 1
        if size == 0:
            return i
        i += size


def _one_frame(im):
    """(image block bytes with a local colour table, transparent index or None)."""
    buf = io.BytesIO()
    im.save(buf, "GIF")
    b = buf.getvalue()
    if b[:6] not in (b"GIF87a", b"GIF89a"):
        raise Problem("a GIF frame could not be encoded")
    flags = b[10]
    i = 13
    gct = b""
    if flags & 0x80:
        n = 3 * (1 << ((flags & 7) + 1))
        gct, gct_bits = b[i:i + n], flags & 7
        i += n
    transparent = None
    while i < len(b):
        kind = b[i]
        if kind == 0x21:
            label = b[i + 1]
            if label == 0xF9 and b[i + 2] == 4 and b[i + 3] & 1:
                transparent = b[i + 6]
            i = _sub_blocks_end(b, i + 2)
        elif kind == 0x2C:
            desc = bytearray(b[i:i + 10])
            packed = desc[9]
            j = i + 10
            if packed & 0x80:
                n = 3 * (1 << ((packed & 7) + 1))
                table = b[j:j + n]
                j += n
            elif gct:
                table = gct
                desc[9] = (packed & 0x60) | 0x80 | gct_bits
            else:
                raise Problem("a GIF frame could not be encoded")
            end = _sub_blocks_end(b, j + 1)   # the code-size byte, then the data
            return bytes(desc) + table + b[j:end], transparent
        elif kind == 0x3B:
            break
        else:
            raise Problem("a GIF frame could not be encoded")
    raise Problem("a GIF frame could not be encoded")


def gif_bytes(frames, durations, w, h):
    out = [b"GIF89a", struct.pack("<HHBBB", w, h, 0, 0, 0),
           b"\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00"]   # loop for ever
    for im, ms in zip(frames, durations):
        block, transparent = _one_frame(im)
        delay = max(1, int(round(ms / 10.0)))
        packed = (2 << 2) | (1 if transparent is not None else 0)   # restore to background
        out.append(struct.pack("<BBBBHBB", 0x21, 0xF9, 4, packed, delay, transparent or 0, 0))
        out.append(block)
    out.append(b"\x3B")
    return b"".join(out)


# --- The two kinds -------------------------------------------------------------

def make_sprite(folder, name, base, space, want_frames):
    from PIL import Image

    frames, w, h = check_frames(space)
    n = len(frames)
    durations = check_durations(space, n)
    tags = check_tags(space, n)
    title = check_title(space, name)
    cols, rows = check_columns(space, n, w, h)

    sheet = Image.new("RGBA", (cols * w, rows * h), (0, 0, 0, 0))
    rects = []
    for i, im in enumerate(frames):
        x, y = (i % cols) * w, (i // cols) * h
        sheet.paste(im, (x, y))
        rects.append((x, y))

    colours = sheet.getcolors(sheet.width * sheet.height) or []
    opaque = sorted(((c, rgba) for c, rgba in colours if rgba[3] == 255),
                    key=lambda e: (-e[0], e[1]))
    palette = ["#%02x%02x%02x" % rgba[:3] for _, rgba in opaque[:PALETTE_MAX]]

    sheet_name, data_name, gif_name = name + "-sheet.png", name + ".json", name + ".gif"
    data = {
        "frames": [{
            "filename": "%s %d.png" % (name, i),
            "frame": {"x": x, "y": y, "w": w, "h": h},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
            "duration": durations[i],
        } for i, (x, y) in enumerate(rects)],
        "meta": {
            "app": "uuu-engine", "version": "1", "image": sheet_name, "format": "RGBA8888",
            "size": {"w": sheet.width, "h": sheet.height}, "scale": "1",
            "frameTags": tags,
        },
    }
    manifest = {
        "name": name, "title": title, "kind": "sprite",
        "sheet": sheet_name, "data": data_name, "gif": gif_name,
        "frames": n, "frameSize": {"w": w, "h": h},
        "tags": [t["name"] for t in tags], "palette": palette,
        "script": base, "made_at": now(),
    }
    sheet_data = png_bytes(sheet)
    gif_data = gif_bytes(frames, durations, w, h)
    frame_files = [("%s-%02d.png" % (name, i), png_bytes(im)) for i, im in enumerate(frames)] if want_frames else []

    # Everything is checked and made; now write. The manifest goes last.
    write_atomic(os.path.join(folder, sheet_name), sheet_data)
    write_atomic(os.path.join(folder, data_name), json_bytes(data))
    write_atomic(os.path.join(folder, gif_name), gif_data)
    if frame_files:
        fdir = os.path.join(folder, "frames")
        if os.path.islink(fdir) or (os.path.exists(fdir) and not os.path.isdir(fdir)):
            raise Problem("frames is not a folder here; remove it and run again")
        os.makedirs(fdir, exist_ok=True)
        for fname, b in frame_files:
            write_atomic(os.path.join(fdir, fname), b)

    # Open what was written and check it again.
    with Image.open(os.path.join(folder, sheet_name)) as im:
        if im.size != (sheet.width, sheet.height):
            raise Problem("the sheet on disk is not the size it should be")
    with Image.open(os.path.join(folder, gif_name)) as im:
        if getattr(im, "n_frames", 1) != n:
            raise Problem("the GIF on disk has %d frames, not %d" % (getattr(im, "n_frames", 1), n))
    write_atomic(os.path.join(folder, "manifest.json"), json_bytes(manifest))

    wrote = [sheet_name, data_name, gif_name]
    if frame_files:
        wrote.append("frames/%s to frames/%s" % (frame_files[0][0], frame_files[-1][0])
                     if len(frame_files) > 1 else "frames/" + frame_files[0][0])
    return "%s: %s of %d × %d, %s, %s. Wrote %s." % (
        name, plural(n, "frame"), w, h, plural(len(tags), "tag"),
        plural(len(opaque), "colour"), ", ".join(wrote))


def make_image(folder, name, base, space):
    text = check_svg(space["svg"])
    title = check_title(space, name)
    image_name = name + ".svg"
    manifest = {"name": name, "title": title, "kind": "image", "image": image_name,
                "script": base, "made_at": now()}
    data = text.encode("utf-8")
    write_atomic(os.path.join(folder, image_name), data)
    write_atomic(os.path.join(folder, "manifest.json"), json_bytes(manifest))
    return "%s: a vector image of %s. Wrote %s." % (
        name, "%.1f KB" % (len(data) / 1024.0) if len(data) >= 1024 else plural(len(data), "byte"), image_name)


def make(script_arg, want_frames):
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
        import PIL  # noqa: F401
    except ImportError:
        raise Problem("the drawing library is not installed; run engine/art/install.sh")

    space = run_script(script)
    has_frames, has_svg = "frames" in space, "svg" in space
    if has_frames and has_svg:
        raise Problem("the script left both `frames` and `svg`; leave one of them")
    if has_frames:
        return make_sprite(folder, name, base, space, want_frames)
    if has_svg:
        return make_image(folder, name, base, space)
    raise Problem("the script left neither `frames` (a list of images) nor `svg` (a string)")


def main(argv):
    want_frames = "--frames" in argv
    rest = [a for a in argv if a != "--frames"]
    if len(rest) != 1 or rest[0].startswith("-"):
        sys.stderr.write("sprite: give one script, for example: sprite.py walker.py [--frames]\n")
        return 1
    try:
        line = make(rest[0], want_frames)
    except Problem as e:
        sys.stderr.write("sprite: %s\n" % e)
        return 1
    except Exception as e:   # Pillow itself failed; still one line
        msg = str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__
        sys.stderr.write("sprite: the sprite could not be made: %s\n" % msg[:200])
        return 1
    sys.stdout.write(line + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
