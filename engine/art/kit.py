#!/usr/bin/env python3
"""The brand kit, for the art tools and the scripts they run (PLAN-V5 K5).

The home server writes the kit, `state/knowledge/docs/brand/kit.json`; nothing
else does. This module only reads it. It is found from where this file is
installed (state/art/tools/kit.py), never from a variable the agent can set.

    kit = load_kit()          # None when there is no kit; KitProblem when it is damaged
    kit.colour("ink")         # (26, 60, 94)
    kit.font("heading", 72)   # a Pillow font of the kit's heading face; refused below minSlidePx
    kit.logo(on="light", height=120)   # an RGBA image, never larger than its file
    kit.place(im, "tower-dusk.jpg", (0, 0, 1080, 700))   # a company or room picture, cover-fitted
    kit.place_logo(im, "bottom-right")                    # keeps the clear space
    kit.margin(1080)          # the kit's margin for that width, in pixels
    kit.palette               # [{"name", "hex", "role", "rgb"}]
    kit.families              # the two family names, for tools that accept only these
    kit.recorded(slides)      # {"pictures": [...], "logo": [...]} for the manifest

A box is (left, top, right, bottom) in pixels, as Pillow's own `crop` and
`paste` take it. `place` and `place_logo` note what they pasted on which image;
`recorded` turns those notes into the manifest's `pictures` and `logo` lists by
the images' identity, so an image copied after the paste loses its notes.

Every problem is a KitProblem with one plain sentence. Reads are capped, by
`lstat`, never through a link. Standard library and Pillow only.
"""
import io
import json
import math
import os
import re
import stat

HERE = os.path.dirname(os.path.abspath(__file__))
# This file lives in state/art/tools; the state folder is two folders up.
STATE = os.path.realpath(os.path.join(HERE, "..", ".."))

KB = 1024
MB = 1024 * KB
MAX_KIT_BYTES = 256 * KB
MAX_PICTURE_BYTES = 50 * MB
MAX_PICTURE_PIXELS = 50 * 1000 * 1000
MAX_FONT_BYTES = 32 * MB
MAX_FONT_SIZE = 1000
MAX_FACES = 32
MAX_FOLDERS = 64                 # folders of the company's files looked through for a picture

COLOUR_NAME = re.compile(r"^[a-z][a-z0-9-]{0,23}$")
HEX = re.compile(r"^#[0-9A-F]{6}$")
FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
ROLES = ("main", "accent", "background", "text", "other")
PICTURE_ENDINGS = (".png", ".jpg", ".jpeg", ".webp")
PICTURE_FORMATS = ("PNG", "JPEG", "WEBP")
CORNERS = ("top-left", "top-right", "bottom-left", "bottom-right")
LOGO_SHARE = 0.08                # a logo in a corner is this share of the image's short side, at least minPx


class KitProblem(Exception):
    pass


def whole(x):
    return isinstance(x, int) and not isinstance(x, bool)


def number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def shown(x, n=40):
    """A value from a script, as it may appear in a sentence: one line, short."""
    s = x if isinstance(x, str) else type(x).__name__
    s = "".join(c for c in s if c.isprintable())
    s = " ".join(s.split())
    return s[:n] + ("…" if len(s) > n else "")


# --- Reading files with distrust -------------------------------------------------

def read_capped(path, cap):
    """The bytes of a regular file, or None when it is missing. Refused (OSError) when it is a link, not a
    regular file, or larger than `cap`. Opened without following a link and without waiting on a pipe."""
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(st.st_mode):
        raise OSError("not a plain file")
    if st.st_size > cap:
        raise OSError("too large")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        fs = os.fstat(fd)
        if not stat.S_ISREG(fs.st_mode) or (fs.st_dev, fs.st_ino) != (st.st_dev, st.st_ino):
            raise OSError("changed while it was read")
        chunks, left = [], cap + 1
        while left > 0:
            b = os.read(fd, min(left, MB))
            if not b:
                break
            chunks.append(b)
            left -= len(b)
    finally:
        os.close(fd)
    data = b"".join(chunks)
    if len(data) > cap:
        raise OSError("too large")
    return data


def open_picture(data, mode="RGB", max_pixels=MAX_PICTURE_PIXELS):
    """A decoded Pillow image from bytes, or ValueError. The size is checked from the header before
    anything is decoded; only PNG, JPEG and WebP are opened; an animated file gives its first frame."""
    from PIL import Image
    import warnings

    if Image.MAX_IMAGE_PIXELS is None or Image.MAX_IMAGE_PIXELS > max_pixels:
        Image.MAX_IMAGE_PIXELS = max_pixels
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        try:
            im = Image.open(io.BytesIO(data), formats=PICTURE_FORMATS)
            w, h = im.size
            if w < 1 or h < 1 or w * h > max_pixels:
                raise ValueError("larger than %d million pixels" % (max_pixels // 1000000))
            im.load()
            return im.convert(mode)
        except ValueError:
            raise
        except Exception:   # a bomb, a truncated or damaged file, a format we do not open
            raise ValueError("could not be read as a picture")


# --- The kit ---------------------------------------------------------------------

def kit_path(state=None):
    return os.path.join(state or STATE, "knowledge", "docs", "brand", "kit.json")


def load_kit(state=None):
    """The kit, None when there is none, or KitProblem when it cannot be read or breaks a rule.
    `state` is for the tests and for brandcheck.py; scripts never need it."""
    path = kit_path(state)
    try:
        data = read_capped(path, MAX_KIT_BYTES)
    except OSError:
        raise KitProblem("The brand kit (brand/kit.json) could not be read: it is not a plain file of "
                         "at most 256 KB.")
    if data is None:
        return None
    try:
        raw = json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise KitProblem("The brand kit (brand/kit.json) is damaged: it is not JSON.")
    return Kit(raw, state or STATE)


def check_kit(raw):
    """The kit's fields that the tools rely on, checked as the home server writes them (K5)."""
    def bad(field, why):
        raise KitProblem("The brand kit is damaged: %s %s." % (field, why))

    if not isinstance(raw, dict):
        bad("the file", "is not an object")
    if raw.get("version") != 1:
        bad("version", "is not 1")
    colours = raw.get("colours")
    if not isinstance(colours, list) or not 2 <= len(colours) <= 8:
        bad("colours", "must hold 2 to 8 colours")
    names, mains = set(), 0
    for i, c in enumerate(colours):
        where = "colours[%d]" % i
        if not isinstance(c, dict):
            bad(where, "is not an object")
        if not isinstance(c.get("name"), str) or not COLOUR_NAME.match(c["name"]):
            bad(where + ".name", "must be a short lower-case name")
        if c["name"] in names:
            bad(where + ".name", "is used twice")
        names.add(c["name"])
        if not isinstance(c.get("hex"), str) or not HEX.match(c["hex"]):
            bad(where + ".hex", "must be written like #1A3C5E")
        if c.get("role") not in ROLES:
            bad(where + ".role", "must be one of " + ", ".join(ROLES))
        mains += c["role"] == "main"
    if mains != 1:
        bad("colours", "must have exactly one main colour")
    if not isinstance(raw.get("neutrals", True), bool):
        bad("neutrals", "must be true or false")

    t = raw.get("type")
    if not isinstance(t, dict):
        bad("type", "is missing")
    for role in ("heading", "body"):
        face = t.get(role)
        if not isinstance(face, dict) or not isinstance(face.get("family"), str) or not face["family"].strip():
            bad("type." + role + ".family", "is missing")
        f = face.get("file")
        if f is not None and (not isinstance(f, str) or not FILE_NAME.match(f)):
            bad("type." + role + ".file", "must be a file name in brand/fonts")
    if not whole(t.get("minPx")) or not 10 <= t["minPx"] <= 40:
        bad("type.minPx", "must be 10 to 40")
    if not whole(t.get("minSlidePx")) or not 16 <= t["minSlidePx"] <= 120:
        bad("type.minSlidePx", "must be 16 to 120")

    logo = raw.get("logo", {})
    if not isinstance(logo, dict):
        bad("logo", "is not an object")
    files = logo.get("files", [])
    if not isinstance(files, list) or len(files) > 8:
        bad("logo.files", "must be a list of at most 8 files")
    for i, f in enumerate(files):
        if not isinstance(f, dict) or not isinstance(f.get("file"), str) or not FILE_NAME.match(f["file"]) \
                or not f["file"].lower().endswith(PICTURE_ENDINGS):
            bad("logo.files[%d].file" % i, "must be a picture's name in Brand")
        if f.get("on", "light") not in ("light", "dark"):
            bad("logo.files[%d].on" % i, "must be light or dark")
    if not number(logo.get("clearSpace", 0.5)) or not 0 <= logo.get("clearSpace", 0.5) <= 2:
        bad("logo.clearSpace", "must be 0 to 2")
    if not number(logo.get("minPx", 48)) or not 1 <= logo.get("minPx", 48) <= 2000:
        bad("logo.minPx", "must be a number of pixels")
    req = logo.get("requiredOn", [])
    if not isinstance(req, list) or not all(isinstance(x, str) for x in req):
        bad("logo.requiredOn", "must be a list of names")

    layout = raw.get("layout", {})
    if not isinstance(layout, dict):
        bad("layout", "is not an object")
    share = layout.get("marginShare", 0.06)
    if not number(share) or not 0 <= share <= 0.25:
        bad("layout.marginShare", "must be 0 to 0.25")
    filler = raw.get("filler", {})
    if not isinstance(filler, dict) or not isinstance(filler.get("block", True), bool) \
            or not isinstance(filler.get("allow", []), list) \
            or not all(isinstance(x, str) for x in filler.get("allow", [])):
        bad("filler", "must say block (true or false) and allow (a list)")


def rgb_of(hexa):
    return (int(hexa[1:3], 16), int(hexa[3:5], 16), int(hexa[5:7], 16))


class Kit:
    def __init__(self, raw, state):
        check_kit(raw)
        self.raw = raw
        self.state = state
        self.brand = os.path.join(state, "knowledge", "docs", "brand")
        self.palette = [{"name": c["name"], "hex": c["hex"], "role": c["role"], "rgb": rgb_of(c["hex"])}
                        for c in raw["colours"]]
        self.neutrals = raw.get("neutrals", True)
        t = raw["type"]
        self.type = {r: t[r] for r in ("heading", "body")}
        self.min_px = t["minPx"]
        self.min_slide_px = t["minSlidePx"]
        self.families = [t["heading"]["family"], t["body"]["family"]]
        logo = raw.get("logo", {})
        self.logo_files = [{"file": f["file"], "on": f.get("on", "light")} for f in logo.get("files", [])]
        self.clear_space = float(logo.get("clearSpace", 0.5))
        self.logo_min_px = logo.get("minPx", 48)
        self.required_on = list(logo.get("requiredOn", []))
        self.margin_share = float(raw.get("layout", {}).get("marginShare", 0.06))
        filler = raw.get("filler", {})
        self.filler_block = filler.get("block", True)
        self.filler_allow = list(filler.get("allow", []))
        self._fonts = {}
        self._placed = []        # {"image", "box", "source"}
        self._logos = []         # {"image", "box", "file"}

    # --- colours and margins

    def colour(self, name):
        for c in self.palette:
            if c["name"] == name:
                return c["rgb"]
        raise KitProblem("The brand kit has no colour named %s. Its colours are %s."
                         % (json.dumps(shown(name)), ", ".join(c["name"] for c in self.palette)))

    def margin(self, w):
        if not number(w) or w <= 0:
            raise KitProblem("kit.margin needs a width in pixels.")
        return int(round(w * self.margin_share))

    # --- type

    def font_paths(self, role):
        """The files to try for a role: the uploaded font, else the family's files in fontmap.json."""
        face = self.type[role]
        if face.get("file"):
            return [os.path.join(self.brand, "fonts", face["file"])]
        try:
            with open(os.path.join(HERE, "fontmap.json"), encoding="utf-8") as fh:
                fmap = json.load(fh)
        except (OSError, ValueError):
            fmap = {}
        want = " ".join(face["family"].lower().split())
        for name, paths in (fmap.items() if isinstance(fmap, dict) else []):
            if isinstance(name, str) and " ".join(name.lower().split()) == want and isinstance(paths, list):
                return [p for p in paths if isinstance(p, str) and os.path.isabs(p)]
        return []

    def font(self, role, size, bold=False):
        from PIL import ImageFont

        if role not in ("heading", "body"):
            raise KitProblem("kit.font takes the role heading or body, not %s." % json.dumps(shown(role)))
        if not whole(size) or not 1 <= size <= MAX_FONT_SIZE:
            raise KitProblem("kit.font needs a whole number of pixels up to %d." % MAX_FONT_SIZE)
        if size < self.min_slide_px:
            raise KitProblem("Type in slides and videos must be at least %d px (the brand kit's minimum); "
                             "this asked for %d px." % (self.min_slide_px, size))
        key = (role, bool(bold))
        if key not in self._fonts:
            self._fonts[key] = self.pick_face(self.font_paths(role), bool(bold))
        choice = self._fonts[key]
        if choice is None:
            raise KitProblem("The brand kit's %s face, %s, could not be loaded on this Mac."
                             % (role, self.type[role]["family"]))
        if choice[0].startswith(self.brand + os.sep):
            return ImageFont.truetype(io.BytesIO(choice[2]), size, index=choice[1])
        return ImageFont.truetype(choice[0], size, index=choice[1])

    def pick_face(self, paths, bold):
        """(path, face index, bytes or None) of the face that fits best, or None."""
        from PIL import ImageFont

        want = ("bold",) if bold else ("regular", "roman", "book", "medium")
        first = None
        for path in paths:
            data = None
            if path.startswith(self.brand + os.sep):   # an uploaded font: read with distrust
                try:
                    data = read_capped(path, MAX_FONT_BYTES)
                except OSError:
                    data = None
                if data is None:
                    continue
            faces = []
            for i in range(MAX_FACES):
                try:
                    f = ImageFont.truetype(io.BytesIO(data) if data is not None else path, 10, index=i)
                except (OSError, ValueError):
                    break
                faces.append((i, (f.getname()[1] or "").strip().lower()))
                if not path.lower().endswith((".ttc", ".otc")):
                    break
            if not faces:
                continue
            if first is None:
                first = (path, faces[0][0], data)
            for style in want:
                for i, s in faces:
                    if s == style:
                        return (path, i, data)
        return first

    # --- the logo

    def logo_file(self, on=None):
        if not self.logo_files:
            raise KitProblem("The brand kit has no logo file.")
        for f in self.logo_files:
            if on is None or f["on"] == on:
                return f["file"]
        return self.logo_files[0]["file"]

    def logo_picture(self, file_name):
        """The logo file as an RGBA image, read from Brand with distrust."""
        try:
            data = read_capped(os.path.join(self.brand, file_name), MAX_PICTURE_BYTES)
            if data is None:
                raise ValueError("missing")
            return open_picture(data, "RGBA")
        except (OSError, ValueError):
            raise KitProblem("The brand kit's logo file %s could not be read." % file_name)

    def logo(self, on="light", height=None):
        from PIL import Image

        if on not in ("light", "dark"):
            raise KitProblem("kit.logo takes on=\"light\" or on=\"dark\".")
        im = self.logo_picture(self.logo_file(on))
        if height is None:
            return im
        if not whole(height) or height < 1:
            raise KitProblem("kit.logo needs a whole number of pixels for its height.")
        height = min(height, im.height)      # never larger than its file
        w = max(1, int(round(im.width * height / float(im.height))))
        return im.resize((w, height), Image.LANCZOS)

    # --- pasting

    def find_picture(self, name):
        """A company picture (state/knowledge/docs and its folders) or a room picture (state/media/room),
        by bare name only. Returns its bytes."""
        if not isinstance(name, str) or not FILE_NAME.match(name) or not name.lower().endswith(PICTURE_ENDINGS):
            raise KitProblem("kit.place takes a picture's bare name, such as tower-dusk.jpg, from the "
                             "company's files or the room.")
        data = find_picture_bytes(self.state, name)
        if data is None:
            raise KitProblem("There is no picture named %s in the company's files or the room." % name)
        return data

    def place(self, image, picture_name, box):
        from PIL import Image

        if not isinstance(image, Image.Image):
            raise KitProblem("kit.place takes the image to paste on first.")
        box = check_box(box, image.size, "kit.place")
        try:
            pic = open_picture(self.find_picture(picture_name), "RGB")
        except ValueError:
            raise KitProblem("The picture %s could not be read." % picture_name)
        fitted = cover_fit(pic, box[2] - box[0], box[3] - box[1])
        image.paste(fitted, box[:2])
        self._placed.append({"image": image, "box": list(box), "source": picture_name})
        return list(box)

    def place_logo(self, image, box_or_corner="bottom-right", on=None):
        from PIL import Image

        if not isinstance(image, Image.Image):
            raise KitProblem("kit.place_logo takes the image to put the logo on first.")
        W, H = image.size
        if on is None:
            on = self.background_of(image)
        file_name = self.logo_file(on)
        pic = self.logo_picture(file_name)
        if isinstance(box_or_corner, str):
            if box_or_corner not in CORNERS:
                raise KitProblem("kit.place_logo takes a box or one of: %s." % ", ".join(CORNERS))
            h = min(pic.height, max(int(math.ceil(self.logo_min_px)), int(round(min(W, H) * LOGO_SHARE))))
            w = max(1, int(round(pic.width * h / float(pic.height))))
            gap = max(self.margin(W), int(math.ceil(self.clear_space * h)))
            x = gap if box_or_corner.endswith("left") else W - gap - w
            y = gap if box_or_corner.startswith("top") else H - gap - h
            box = (x, y, x + w, y + h)
        else:
            outer = check_box(box_or_corner, image.size, "kit.place_logo")
            bw, bh = outer[2] - outer[0], outer[3] - outer[1]
            scale = min(bw / float(pic.width), bh / float(pic.height), 1.0)   # contained, never upscaled
            w, h = max(1, int(pic.width * scale)), max(1, int(pic.height * scale))
            x, y = outer[0] + (bw - w) // 2, outer[1] + (bh - h) // 2
            box = (x, y, x + w, y + h)
        need = int(math.ceil(self.clear_space * (box[3] - box[1])))
        if min(box[0], box[1], W - box[2], H - box[3]) < need:
            raise KitProblem("The logo needs %d px of clear space from every edge (the brand kit's rule); "
                             "move it in." % need)
        if box[3] - box[1] < self.logo_min_px:
            raise KitProblem("The logo must be at least %d px high (the brand kit's minimum)."
                             % int(math.ceil(self.logo_min_px)))
        mark = pic.resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS)
        if image.mode == "RGBA":
            image.alpha_composite(mark, box[:2])
        else:
            image.paste(mark, box[:2], mark)
        self._logos.append({"image": image, "box": list(box), "file": file_name})
        return list(box)

    def background_of(self, image):
        """light or dark: the side of the logo files that suits the image's own brightness."""
        from PIL import ImageStat

        mean = ImageStat.Stat(image.convert("L").resize((32, 32))).mean[0]
        return "light" if mean >= 128 else "dark"

    def recorded(self, images, key="slide", labels=None):
        """{"pictures": [{key, box, source}], "logo": [{file, key, box}]} for the images given, in order:
        key is "slide" (numbered from 1) or "frame"; `labels` gives each image's value instead."""
        out = {"pictures": [], "logo": []}
        for i, im in enumerate(images):
            label = labels[i] if labels is not None else i + 1
            for r in self._placed:
                if r["image"] is im:
                    out["pictures"].append({key: label, "box": r["box"], "source": r["source"]})
            for r in self._logos:
                if r["image"] is im:
                    out["logo"].append({"file": r["file"], key: label, "box": r["box"]})
        return out


# --- Shared with brandcheck.py -----------------------------------------------------

def check_box(box, size, who):
    if not isinstance(box, (list, tuple)) or len(box) != 4 or not all(whole(v) for v in box):
        raise KitProblem("%s takes a box of four whole numbers: left, top, right, bottom." % who)
    l, t, r, b = box
    if not (0 <= l < r <= size[0] and 0 <= t < b <= size[1]):
        raise KitProblem("%s: the box must lie inside the %d × %d image." % (who, size[0], size[1]))
    return (l, t, r, b)


def cover_rect(pw, ph, w, h):
    """The part of a pw x ph picture that, scaled, just covers w x h: the largest centred rectangle of the
    box's shape. Never larger than the picture itself."""
    if pw * h > ph * w:                  # the picture is wider than the box: keep its full height
        cw, ch = ph * w / float(h), float(ph)
    else:
        cw, ch = float(pw), pw * h / float(w)
    x, y = (pw - cw) / 2.0, (ph - ch) / 2.0
    return (x, y, x + cw, y + ch)


def cover_fit(pic, w, h):
    """The picture scaled to just cover w × h, centred, cropped to it. The crop is taken first and resized
    straight to w × h, so nothing larger than the source or the box is ever made."""
    from PIL import Image

    return pic.resize((w, h), Image.LANCZOS, box=cover_rect(pic.width, pic.height, w, h))


def find_picture_bytes(state, name, cap=MAX_PICTURE_BYTES):
    """Bytes of the picture named `name` (a bare name, already checked) in the room or the company's files
    (knowledge/docs and the folders directly in it), or None. Links and odd files are passed over."""
    room = os.path.join(state, "media", "room")
    docs = os.path.join(state, "knowledge", "docs")
    folders = [room, docs]
    try:
        with os.scandir(docs) as it:
            subs = sorted(e.name for e in it if e.is_dir(follow_symlinks=False))
    except OSError:
        subs = []
    folders += [os.path.join(docs, s) for s in subs[:MAX_FOLDERS]]
    for folder in folders:
        try:
            data = read_capped(os.path.join(folder, name), cap)
        except OSError:
            continue
        if data is not None:
            return data
    return None
