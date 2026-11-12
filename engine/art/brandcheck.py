#!/usr/bin/env python3
"""The brand check by code (PLAN-V5 K6): reads a goal's pieces and says, by
exact measures, where they break the brand kit, the owner's can't-say list or
the shipped list of machine-sounding filler.

    cd <task folder> && "$UUU_BRAND_PY" -I "$UUU_BRAND_CHECK" [--json] <goal id>

It writes nothing. It finds the pieces by listing the goal's folder itself
(content/*.md, drafts/*.md, slides/*/, video/*/, film/*/, site/*/; at most 40)
and never opens a path that a piece's own files name: a manifest's claims (a
company picture in a box, a logo in a box) are checked against the pixels, and
the picture a claim names is looked up by bare name in the company's files and
the room only. Every file is read by `lstat` first, without following a link,
with a cap: text 256 KB, pictures 20 MB and 50 million pixels (the size is read
from the header before anything is decoded). 30 seconds a piece, 120 in all.

Exit 0: every piece passes or only warns. Exit 1: a hard rule failed.
Exit 2: it could not check (a bad goal, no pieces, a kit it cannot read, time).

Without --json: one plain line per piece. With --json, K6's shape:
  {"version": 1, "kit": "present|missing|unreadable",
   "pieces": [{"kind", "name", "result": "pass|warn|fail", "hard": [{"code", "where", "detail"}],
               "soft": [...], "measured": {"colours": ["#1A3C5E 61%"], "words": 212}}],
   "variants": {"result", "hard": [], "present": bool}}
Every `detail` and `where` is built from fixed words, numbers, hex colours, the
kit's names, phrases of the owner's own list or of the shipped filler list, and
file names matching ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ (else "a file with an
unusual name"). Nothing else a maker wrote is ever echoed.

The state folder is found from where this file is installed (state/art/tools).
`--state` is accepted only when the file is not in a folder named `tools`
(the tests). Installed by engine/art/install.sh beside kit.py, fontmap.json,
filler.json and directions.json, and run with the Artist's own Python.
Standard library and Pillow only.
"""
import json
import math
import os
import re
import signal
import stat
import sys
import time
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)        # kit.py beside this file (-I leaves the script's folder out of the path)
sys.dont_write_bytecode = True  # it writes nothing, not even a cache beside itself
import kit as kitmod  # noqa: E402

KB = 1024
MB = 1024 * KB
MAX_PIECES = 40
MAX_TEXT_BYTES = 256 * KB
MAX_PICTURE_BYTES = 20 * MB
MAX_PICTURE_PIXELS = 50 * 1000 * 1000
MAX_SMALL_JSON = 64 * KB         # a manifest, the can't-say list, the filler list, directions
MAX_VARIANTS_JSON = 16 * KB
MAX_LISTED = 500                 # entries looked at in one folder
MAX_SCRIPTS = 8
MAX_JSON_FILES = 6
MAX_CLAIMS = 40
MAX_SLIDES = 10
MAX_PHRASES = 200
PIECE_SECONDS = 30
TOTAL_SECONDS = 120

# The measures (K6). Why each number: see the README section "The brand check".
SCALE_TO = 512                   # long side, nearest neighbour
FLAT_RANGE = 6                   # a pixel is flat when each channel varies by at most this over 3 x 3
CLUSTERS = 16                    # flat colours are cut to this many (median cut)
NEAR = 10.0                      # CIE76 distance in Lab (D65) that still counts as the kit's colour
GREY_CHROMA = 8.0                # with neutrals, a colour this close to grey is fine
BLEND_STEPS = 32                 # a blend between two colours is followed in this many steps
OFF_HARD = 0.05                  # off-palette share of the picture: hard
OFF_SOFT = 0.02                  # and soft
CLAIM_SIZE = 64
CLAIM_PIXEL = 30                 # a pixel agrees when no channel differs by more than this
CLAIM_SHARE = 0.70               # and a claim holds when this share of pixels agree
LOGO_MEAN = 16.0                 # mean difference over the logo's opaque pixels
LOGO_COMPARE_MAX = 256           # long side the logo is compared at
ALIKE_GREY = 10.0                # two variants' first pictures closer than this on average are near copies
ALIKE_SHARE = 0.5                # or texts sharing more than this share of word three-grams
ALIKE_MIN_GRAMS = 10             # texts shorter than this many three-grams are not compared
DASH_PER_WORDS = 100

FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
VARIANT_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,35}$")
GOAL_ID = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,9}-[0-9]{1,9}$")
SLIDE_FILE = re.compile(r"^slide-(\d\d)\.png$")
SHOT_FILE = re.compile(r"^shot-\d\d\.png$")
STILL_FILE = re.compile(r"^frame-0[1-6]\.png$")
CARDS = ("title-card", "end-card")
PLACEHOLDER = "(not filled in yet)"
UNUSUAL = "a file with an unusual name"

FOLDERS = (("content", "content", False), ("drafts", "draft", False), ("slides", "slides", True),
           ("video", "video", True), ("film", "film", True), ("site", "site", True))
VARIANT_PLACES = {"post": ("drafts", False), "newsletter": ("drafts", False), "carousel": ("slides", True),
                  "poster": ("slides", True), "title-card": ("video", True), "film": ("film", True),
                  "page": ("site", True)}


class Problem(Exception):
    """The check could not be made at all: exit 2."""


class PieceProblem(Exception):
    """This piece could not be checked: a hard `could_not_check` on it."""


class OutOfTime(Exception):
    pass


def safe(name):
    return name if isinstance(name, str) and FILE_NAME.match(name) else UNUSUAL


def owner_words(s, n=80):
    """A phrase of the owner's list or the shipped list, as it may appear in a detail."""
    s = "".join(c for c in s if c.isprintable()).replace('"', "'")
    s = " ".join(s.split())
    return s[:n] + ("…" if len(s) > n else "")


def pct(x, digits=1):
    return ("%." + str(digits) + "f%%") % (x * 100)


# --- Reading with distrust ------------------------------------------------------------

def listing(folder):
    """[(name, kind)] of a folder, kind "file", "dir" or "other", by lstat (a link is "other"); sorted, capped."""
    out = []
    try:
        with os.scandir(folder) as it:
            for e in it:
                if len(out) >= MAX_LISTED:
                    break
                try:
                    st = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                kind = "file" if stat.S_ISREG(st.st_mode) else "dir" if stat.S_ISDIR(st.st_mode) else "other"
                out.append((e.name, kind))
    except OSError:
        return []
    return sorted(out)


def read_bytes(path, cap, what):
    try:
        data = kitmod.read_capped(path, cap)
    except OSError:
        raise PieceProblem("%s is not a plain file of at most %s" % (safe(os.path.basename(path)), size_words(cap)))
    if data is None:
        raise PieceProblem("%s is missing" % safe(os.path.basename(path)))
    return data


def size_words(cap):
    return "%d MB" % (cap // MB) if cap >= MB else "%d KB" % (cap // KB)


def read_text(path):
    return read_bytes(path, MAX_TEXT_BYTES, "text").decode("utf-8", errors="replace")


def read_json(path, cap):
    """Parsed JSON, None when the file is missing; PieceProblem when it is odd."""
    try:
        data = kitmod.read_capped(path, cap)
    except OSError:
        raise PieceProblem("%s is not a plain file of at most %s" % (safe(os.path.basename(path)), size_words(cap)))
    if data is None:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise PieceProblem("%s is not JSON" % safe(os.path.basename(path)))


def read_picture(path, mode="RGB"):
    data = read_bytes(path, MAX_PICTURE_BYTES, "picture")
    try:
        return kitmod.open_picture(data, mode, MAX_PICTURE_PIXELS)
    except ValueError as e:
        raise PieceProblem("%s %s" % (safe(os.path.basename(path)), e))


# --- Words ----------------------------------------------------------------------------

QUOTES = {ord(c): "'" for c in "‘’‚‛′´`"}
QUOTES.update({ord(c): '"' for c in "“”„‟″«»"})
MARKUP = re.compile(r"[*_~`]")
LINK_TARGET = re.compile(r"\]\([^)\n]{0,2000}\)")
SEP = r"[ \-‐-―]"


def normalise(text):
    """NFKC, invisible format characters dropped, straight quotes, lower case, markup marks dropped,
    one space for any run of white space (so a phrase is found across a line break)."""
    text = unicodedata.normalize("NFKC", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Cf")
    text = text.translate(QUOTES).lower()
    text = LINK_TARGET.sub("]", text)
    text = MARKUP.sub("", text)
    return " ".join(text.split())


def phrase_pattern(phrase):
    """A phrase matched on word edges: not inside a longer word; a space or hyphen in it matches either."""
    p = normalise(phrase).strip(" .,;:!?")
    if len(p) < 2:
        return None
    parts = [re.escape(x) for x in re.split(SEP + "+", p) if x]
    if not parts:
        return None
    body = SEP.join(parts)
    left = r"(?<!\w)" if re.match(r"\w", p[0]) else ""
    right = r"(?!\w)" if re.match(r"\w", p[-1]) else ""
    return re.compile(left + body + right)


def words_in(text):
    return re.findall(r"\w+", text)


def dashes_in(text):
    return text.count("—") + text.count(" – ") + text.count(" -- ")


def load_cant_say(state):
    """[(phrase, which)] from brand/cant-say.md: which is "words" or "claims". Missing: []."""
    path = os.path.join(state, "knowledge", "docs", "brand", "cant-say.md")
    try:
        data = kitmod.read_capped(path, MAX_SMALL_JSON)
    except OSError:
        raise Problem("the can't-say list (brand/cant-say.md) could not be read")
    if data is None:
        return []
    out, which = [], "words"
    for line in data.decode("utf-8", errors="replace").splitlines():
        s = line.strip()
        if s.startswith("#"):
            which = "claims" if "claim" in s.lower() else "words"
            continue
        m = re.match(r"^[-*+]\s+(.*)$", s)
        if not m:
            continue
        item = m.group(1).strip()
        if item.startswith("\\"):
            item = item[1:]
        if item and item != PLACEHOLDER and len(item) <= 200 and len(out) < MAX_PHRASES:
            out.append((item, which))
    return out


def load_filler(state):
    """{"hard": [...], "soft": [...]} from filler.json beside the tool (the repo's engine/company/brand when
    the tool is run from the repo), or None when it cannot be read."""
    places = [os.path.join(HERE, "filler.json")]
    if os.path.basename(HERE) != "tools":
        places.append(os.path.join(HERE, "..", "company", "brand", "filler.json"))
    for p in places:
        try:
            raw = read_json(p, MAX_SMALL_JSON)
        except PieceProblem:
            return None
        if raw is None:
            continue
        if not isinstance(raw, dict):
            return None
        out = {}
        for k in ("hard", "soft"):
            v = raw.get(k, [])
            if not isinstance(v, list):
                return None
            out[k] = [x for x in v if isinstance(x, str) and 2 <= len(x) <= 60][:MAX_PHRASES]
        return out
    return None


def load_directions():
    """{"kinds": {kind: [ids]}, "alias": {}} from directions.json, found as filler.json is; None when missing."""
    places = [os.path.join(HERE, "directions.json")]
    if os.path.basename(HERE) != "tools":
        places.append(os.path.join(HERE, "..", "company", "brand", "directions.json"))
    for p in places:
        try:
            raw = read_json(p, MAX_SMALL_JSON)
        except PieceProblem:
            return None
        if raw is None:
            continue
        if not isinstance(raw, dict) or not isinstance(raw.get("kinds"), dict):
            return None
        kinds = {}
        for k, v in raw["kinds"].items():
            if isinstance(k, str) and isinstance(v, list):
                kinds[k] = [d.get("id") for d in v if isinstance(d, dict) and isinstance(d.get("id"), str)]
        alias = raw.get("alias") if isinstance(raw.get("alias"), dict) else {}
        return {"kinds": kinds, "alias": {k: v for k, v in alias.items() if isinstance(v, str)}}
    return None


class Words:
    """The phrase rules, compiled once."""

    def __init__(self, cant, filler, kit):
        self.rules = []          # (pattern, code, hard, detail)
        for phrase, which in cant:
            pat = phrase_pattern(phrase)
            if pat:
                what = "your list of claims never to make" if which == "claims" else "your list of words never to use"
                self.rules.append((pat, "banned_phrase", True, '"%s" is on %s' % (owner_words(phrase), what)))
        self.filler = filler is not None and (kit is None or kit.filler_block)
        self.filler_missing = filler is None and (kit is None or kit.filler_block)
        if self.filler:
            allow = {normalise(a) for a in (kit.filler_allow if kit else [])}
            for level in ("hard", "soft"):
                for phrase in filler[level]:
                    if normalise(phrase) in allow:
                        continue
                    pat = phrase_pattern(phrase)
                    if pat:
                        self.rules.append((pat, "filler_phrase", level == "hard",
                                           '"%s" is machine-sounding filler' % owner_words(phrase)))

    def check(self, piece, sources):
        """sources: [(where, text)]. Adds hard and soft entries and measured words."""
        total_words, dashes, seen = 0, 0, set()
        for where, text in sources:
            t = normalise(text)
            total_words += len(words_in(t))
            dashes += dashes_in(t)
            for pat, code, hard, detail in self.rules:
                if detail in seen:
                    continue
                if pat.search(t):
                    seen.add(detail)
                    piece.add(code, where, detail, hard)
        piece.measured["words"] = total_words
        if self.filler and dashes > max(1.0, total_words / float(DASH_PER_WORDS)):
            piece.add("filler_phrase", sources[0][0] if sources else piece.where, "%d em dashes in %d words; "
                      "keep to one in %d words" % (dashes, total_words, DASH_PER_WORDS), False)
        if self.filler_missing and sources:
            piece.add("could_not_check", piece.where, "the shipped filler list could not be read, so filler "
                      "was not checked", False)


# --- Colours ---------------------------------------------------------------------------

def lab(rgb):
    """sRGB 0-255 -> CIE Lab, D65."""
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(float(v)) for v in rgb)
    x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883

    def f(t):
        return t ** (1.0 / 3) if t > (6.0 / 29) ** 3 else t / (3 * (6.0 / 29) ** 2) + 4.0 / 29
    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def to_segment(p, a, b):
    ab = [b[i] - a[i] for i in range(3)]
    ap = [p[i] - a[i] for i in range(3)]
    n = sum(v * v for v in ab)
    t = 0.0 if n == 0 else max(0.0, min(1.0, sum(ab[i] * ap[i] for i in range(3)) / n))
    return math.sqrt(sum((ap[i] - t * ab[i]) ** 2 for i in range(3)))


class Palette:
    """Which colours are the kit's: near a kit colour, near a blend of two of them (followed in sRGB, as
    Pillow blends, and as a straight line in Lab), or, with neutrals, near grey. With neutrals, white and
    black join the colours blends start from, so tints and shades of a kit colour count too."""

    def __init__(self, kit):
        anchors = [c["rgb"] for c in kit.palette]
        self.neutrals = kit.neutrals
        if self.neutrals:
            anchors += [(255, 255, 255), (0, 0, 0)]
        self.points = [lab(a) for a in anchors]
        self.segments = []
        for i in range(len(anchors)):
            for j in range(i + 1, len(anchors)):
                a, b = anchors[i], anchors[j]
                self.segments.append((self.points[i], self.points[j]))
                steps = [lab(tuple(a[k] + (b[k] - a[k]) * s / float(BLEND_STEPS) for k in range(3)))
                         for s in range(BLEND_STEPS + 1)]
                self.segments += list(zip(steps, steps[1:]))
        self.cache = {}

    def on(self, rgb):
        if rgb not in self.cache:
            p = lab(rgb)
            ok = self.neutrals and math.hypot(p[1], p[2]) <= GREY_CHROMA
            if not ok:
                ok = any(math.sqrt(sum((p[i] - q[i]) ** 2 for i in range(3))) <= NEAR for q in self.points)
            if not ok:
                ok = any(to_segment(p, a, b) <= NEAR for a, b in self.segments)
            self.cache[rgb] = ok
        return self.cache[rgb]


def hexa(rgb):
    return "#%02X%02X%02X" % tuple(rgb)


def flat_colours(im, exempt):
    """(total pixels, [(rgb, pixels)]) of the picture's flat colours, outside the exempt boxes, cut to 16."""
    from PIL import Image, ImageChops, ImageDraw, ImageFilter

    W, H = im.size
    s = min(1.0, SCALE_TO / float(max(W, H)))
    small = im if s >= 1 else im.resize((max(1, int(round(W * s))), max(1, int(round(H * s)))), Image.NEAREST)
    spread = ImageChops.subtract(small.filter(ImageFilter.MaxFilter(3)), small.filter(ImageFilter.MinFilter(3)))
    bands = [b.point(lambda v: 255 if v <= FLAT_RANGE else 0) for b in spread.split()]
    mask = ImageChops.darker(ImageChops.darker(bands[0], bands[1]), bands[2])
    if exempt:
        d = ImageDraw.Draw(mask)
        for l, t, r, b in exempt:
            d.rectangle([int(l * s) - 1, int(t * s) - 1, int(math.ceil(r * s)), int(math.ceil(b * s))], fill=0)
    m = mask.tobytes()
    rgb = small.tobytes()
    idx = [i for i, v in enumerate(m) if v]
    if not idx:
        return len(m), []
    flat = Image.frombytes("RGB", (len(idx), 1), b"".join(rgb[3 * i:3 * i + 3] for i in idx))
    q = flat.quantize(colors=CLUSTERS, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette() or []
    out = []
    for count, i in q.getcolors(256) or []:
        out.append((tuple(pal[3 * i:3 * i + 3]), count))
    return len(m), out


# --- Pictures: claims, logo, palette ---------------------------------------------------

def check_box(box, size):
    try:
        return kitmod.check_box(box, size, "box")
    except kitmod.KitProblem:
        return None


def claim_holds(state, im, box, source):
    """True when the picture named by bare name, cover-fitted to the box, is what the box shows."""
    from PIL import Image, ImageChops

    if not isinstance(source, str) or not FILE_NAME.match(source) \
            or not source.lower().endswith(kitmod.PICTURE_ENDINGS):
        return False
    data = kitmod.find_picture_bytes(state, source, MAX_PICTURE_BYTES)
    if data is None:
        return False
    try:
        pic = kitmod.open_picture(data, "RGB", MAX_PICTURE_PIXELS)
    except ValueError:
        return False
    w, h = box[2] - box[0], box[3] - box[1]
    want = kitmod.cover_fit(pic, w, h).resize((CLAIM_SIZE, CLAIM_SIZE), Image.BILINEAR)
    got = im.crop(box).resize((CLAIM_SIZE, CLAIM_SIZE), Image.BILINEAR)
    r, g, b = ImageChops.difference(want, got).split()
    worst = ImageChops.lighter(ImageChops.lighter(r, g), b)
    agree = worst.point(lambda v: 255 if v <= CLAIM_PIXEL else 0).histogram()[255]
    return agree >= CLAIM_SHARE * CLAIM_SIZE * CLAIM_SIZE


def logo_difference(im, box, mark):
    """Mean difference (0-255) between the box and the logo file scaled to it, over the logo's opaque pixels."""
    from PIL import Image, ImageChops, ImageStat

    w, h = box[2] - box[0], box[3] - box[1]
    crop = im.crop(box)
    scaled = mark.resize((w, h), Image.LANCZOS)
    s = min(1.0, LOGO_COMPARE_MAX / float(max(w, h)))
    if s < 1:
        size = (max(1, int(w * s)), max(1, int(h * s)))
        crop, scaled = crop.resize(size, Image.BOX), scaled.resize(size, Image.BOX)
    alpha = scaled.getchannel("A")
    n = alpha.size[0] * alpha.size[1]
    mask = alpha.point(lambda v: 255 if v >= 250 else 0)
    if mask.histogram()[255] < 0.01 * n:
        mask = alpha.point(lambda v: 255 if v >= 128 else 0)
    if mask.histogram()[255] == 0:
        mask = None
    diff = ImageChops.difference(crop, scaled.convert("RGB"))
    return sum(ImageStat.Stat(diff, mask).mean) / 3.0


class Ctx:
    def __init__(self, state, kit, kit_status, words, directions, deadline):
        self.state, self.kit, self.kit_status = state, kit, kit_status
        self.words, self.directions = words, directions
        self.palette = Palette(kit) if kit else None
        self.deadline = deadline
        self.logos = None

    def logo_pictures(self):
        if self.logos is None:
            self.logos = {}
            for f in self.kit.logo_files:
                try:
                    self.logos[f["file"]] = self.kit.logo_picture(f["file"])
                except kitmod.KitProblem:
                    pass
        return self.logos


class Piece:
    def __init__(self, kind, name, path, is_dir):
        self.kind, self.name, self.path, self.is_dir = kind, name, path, is_dir
        self.where = safe(os.path.basename(path))
        self.hard, self.soft = [], []
        self.measured = {"colours": [], "words": 0}
        self.texts = []
        self.first_picture = None
        self.variant_kind = None
        self.started = None

    def add(self, code, where, detail, hard=True):
        (self.hard if hard else self.soft).append({"code": code, "where": where, "detail": detail})

    def tick(self):
        if time.monotonic() - self.started > PIECE_SECONDS:
            raise PieceProblem("it took longer than %d seconds" % PIECE_SECONDS)

    def result(self):
        return "fail" if self.hard else "warn" if self.soft else "pass"

    def shape(self):
        return {"kind": self.kind, "name": safe(self.name), "result": self.result(), "hard": self.hard,
                "soft": self.soft, "measured": self.measured}


def manifest_lists(piece):
    """The manifest's `pictures` and `logo` lists (only their numbers and bare names are ever used)."""
    raw = read_json(os.path.join(piece.path, "manifest.json"), MAX_SMALL_JSON)
    if raw is None:
        return {}, [], []
    if not isinstance(raw, dict):
        raise PieceProblem("manifest.json is not an object")
    pics = raw.get("pictures") if isinstance(raw.get("pictures"), list) else []
    logos = raw.get("logo") if isinstance(raw.get("logo"), list) else []
    return raw, [p for p in pics[:MAX_CLAIMS] if isinstance(p, dict)], [p for p in logos[:MAX_CLAIMS] if isinstance(p, dict)]


def check_pictures(ctx, piece, pictures, pics, logos, required):
    """pictures: [(label, file name, path)] (label: a slide number or a frame name). Claims, logo, palette."""
    counts, total_pixels = {}, 0
    found = set()
    for label, fname, path in pictures:
        piece.tick()
        im = read_picture(path)
        exempt = []
        key = "slide" if isinstance(label, int) else "frame"
        for c in pics:
            if c.get(key) != label:
                continue
            box = check_box(c.get("box"), im.size)
            if box is None:
                piece.add("picture_claim_false", fname, "a picture box in the manifest is not a box inside the picture")
            elif claim_holds(ctx.state, im, box, c.get("source")):
                exempt.append(box)
            else:
                piece.add("picture_claim_false", fname, "the box at %d, %d (%d × %d) does not show the company "
                          "picture %s" % (box[0], box[1], box[2] - box[0], box[3] - box[1], safe(c.get("source"))))
            piece.tick()
        if ctx.kit:
            hard = label in required
            for entry in logos:
                if entry.get(key) != label:
                    continue
                found.add(label)
                box = check_box(entry.get("box"), im.size)
                if box is None:
                    piece.add("wrong_logo", fname, "the logo box in the manifest is not a box inside the picture", hard)
                    continue
                if check_logo(ctx, piece, im, fname, box, entry.get("file"), hard):
                    exempt.append(box)
                piece.tick()
            if hard and label not in found:
                piece.add("no_logo", fname, "this needs the logo (the brand kit asks for it here) and none "
                          "was placed with kit.place_logo")
            n, colours = flat_colours(im, exempt)
            total_pixels += n
            off = 0
            for rgb, count in colours:
                counts[rgb] = counts.get(rgb, 0) + count
                if not ctx.palette.on(rgb):
                    off += count
            share = off / float(n)
            if share >= OFF_SOFT:
                offs = sorted(((c, rgb) for rgb, c in colours if not ctx.palette.on(rgb)), reverse=True)[:3]
                detail = "%s of the picture is in colours outside the brand kit: %s" % (
                    pct(share), ", ".join("%s %s" % (hexa(rgb), pct(c / float(n))) for c, rgb in offs))
                piece.add("off_palette", fname, detail, share >= OFF_HARD)
    if total_pixels:
        top = sorted(((c, rgb) for rgb, c in counts.items()), reverse=True)[:6]
        piece.measured["colours"] = ["%s %d%%" % (hexa(rgb), round(100.0 * c / total_pixels)) for c, rgb in top]


def check_logo(ctx, piece, im, fname, box, named, hard):
    """True when the box holds one of the kit's logo files. Adds wrong_logo, logo_small, logo_crowded."""
    marks = ctx.logo_pictures()
    names = [f["file"] for f in ctx.kit.logo_files]
    ok = False
    if named in names and marks:
        ok = min(logo_difference(im, box, m) for m in marks.values()) <= LOGO_MEAN
    if not ok:
        piece.add("wrong_logo", fname, "the logo box does not show the brand kit's logo file", hard)
    h = box[3] - box[1]
    if h < ctx.kit.logo_min_px:
        piece.add("logo_small", fname, "the logo is %d px high; the brand kit asks for at least %d px"
                  % (h, int(math.ceil(ctx.kit.logo_min_px))), hard)
    edge = min(box[0], box[1], im.size[0] - box[2], im.size[1] - box[3])
    need = ctx.kit.clear_space * h
    if edge + 1e-9 < need:
        piece.add("logo_crowded", fname, "the logo is %d px from an edge; the brand kit asks for %d px of clear "
                  "space" % (edge, int(math.ceil(need))), hard)
    return ok


def check_scripts(ctx, piece, entries):
    if not ctx.kit:
        return
    for name, kind in [e for e in entries if e[1] == "file" and e[0].endswith(".py")][:MAX_SCRIPTS]:
        text = read_text(os.path.join(piece.path, name))
        low = text.lower()
        if "imagefont.truetype" in low or "load_default" in low or "truetype(" in low \
                or any(x in low for x in (".ttf", ".otf", ".ttc")):
            piece.add("font_loaded_directly", safe(name), "the script loads a typeface itself; take type "
                      "from kit.font so it is the brand kit's")


def json_strings(value, out, depth=0):
    if len(out) > 2000 or depth > 6:
        return
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, list):
        for v in value:
            json_strings(v, out, depth + 1)
    elif isinstance(value, dict):
        for v in value.values():
            json_strings(v, out, depth + 1)


def check_folder_piece(ctx, piece):
    entries = listing(piece.path)
    names = {n: k for n, k in entries}
    raw, pics, logos = manifest_lists(piece)
    texts = []
    if names.get("copy.md") == "file":
        texts.append(("copy.md", read_text(os.path.join(piece.path, "copy.md"))))
    if isinstance(raw.get("title"), str):
        texts.append(("manifest.json", raw["title"][:500]))
    pictures, required = [], set()
    req = ctx.kit.required_on if ctx.kit else []

    if piece.kind == "slides":
        data = read_json(os.path.join(piece.path, "slides.json"), MAX_TEXT_BYTES) if names.get("slides.json") == "file" else None
        if isinstance(data, dict) and isinstance(data.get("slides"), list):
            for i, s in enumerate(data["slides"][:MAX_SLIDES]):
                if isinstance(s, dict) and isinstance(s.get("text"), str):
                    texts.append(("slide %d" % (i + 1), s["text"]))
        # A slide-NN.png that is a link or a pipe is still a slide: reading it refuses it (could_not_check).
        slides = sorted(n for n, k in entries if k != "dir" and SLIDE_FILE.match(n))[:MAX_SLIDES]
        pictures = [(int(SLIDE_FILE.match(n).group(1)), n, os.path.join(piece.path, n)) for n in slides]
        if pictures:
            piece.first_picture = pictures[0][2]
            last = pictures[-1][0]
            poster = piece.variant_kind == "poster"
            if (poster and "poster" in req) or (not poster and "carousel-last" in req):
                required.add(last)
    elif piece.kind == "video":
        for n, k in [e for e in entries if e[1] == "file" and e[0].endswith(".json") and e[0] != "manifest.json"][:MAX_JSON_FILES]:
            data = read_json(os.path.join(piece.path, n), MAX_TEXT_BYTES)
            if isinstance(data, list) and data and all(isinstance(w, dict) for w in data[:5]):
                texts.append(("caption words", " ".join(w["w"] for w in data if isinstance(w, dict) and isinstance(w.get("w"), str))))
            elif isinstance(data, dict):
                found = []
                for s in data.get("shots", []) if isinstance(data.get("shots"), list) else []:
                    if isinstance(s, dict) and isinstance(s.get("caption"), str):
                        found.append(s["caption"])
                if isinstance(data.get("title"), str):
                    found.append(data["title"])
                if isinstance(data.get("cards"), dict):
                    json_strings(data["cards"], found)
                if found:
                    texts.append((safe(n), "\n".join(found)))
        made_by_script = raw.get("made_by") == "render" or any(k == "file" and n.endswith(".py") for n, k in entries)
        if names.get("poster.png") == "file":
            piece.first_picture = os.path.join(piece.path, "poster.png")
            if made_by_script:
                pictures.append(("poster", "poster.png", piece.first_picture))
        if made_by_script and names.get("review") == "dir":
            for n, k in listing(os.path.join(piece.path, "review")):
                if k == "file" and STILL_FILE.match(n):
                    pictures.append((n[:-4], n, os.path.join(piece.path, "review", n)))
        for card in CARDS:
            if names.get(card + ".png") == "file":
                pictures.append((card, card + ".png", os.path.join(piece.path, card + ".png")))
                if card in req:
                    required.add(card)
    elif piece.kind == "film":
        if names.get("shotlist.json") == "file":
            found = []
            json_strings(read_json(os.path.join(piece.path, "shotlist.json"), MAX_TEXT_BYTES), found)
            texts.append(("shotlist.json", "\n".join(found)))
        if names.get("board") == "dir":
            shots = sorted(n for n, k in listing(os.path.join(piece.path, "board")) if k == "file" and SHOT_FILE.match(n))
            if shots:
                piece.first_picture = os.path.join(piece.path, "board", shots[0])

    piece.texts = texts
    ctx.words.check(piece, texts)
    piece.tick()
    if piece.kind in ("slides", "video"):
        check_scripts(ctx, piece, entries)
        check_pictures(ctx, piece, pictures, pics, logos, required)


def check_piece(ctx, piece):
    piece.started = time.monotonic()
    try:
        if piece.is_dir:
            check_folder_piece(ctx, piece)
        else:
            text = read_text(piece.path)
            piece.texts = [(piece.where, text)]
            ctx.words.check(piece, piece.texts)
    except PieceProblem as e:
        piece.add("could_not_check", piece.where, str(e))
    except (OutOfTime, KeyboardInterrupt):
        raise
    except Exception:   # Pillow or the system failed on a hostile file: this piece only
        piece.add("could_not_check", piece.where, "a file of this piece could not be read")


# --- Variants ------------------------------------------------------------------------------

def grams(text):
    w = words_in(normalise(text))
    return set(zip(w, w[1:], w[2:]))


def grey64(path):
    from PIL import Image
    return read_picture(path, "L").resize((64, 64), Image.BOX)


def check_variants(ctx, goal, by_path):
    out = {"result": "pass", "hard": [], "present": False}
    path = os.path.join(goal, "variants.json")
    try:
        raw = read_json(path, MAX_VARIANTS_JSON)
    except PieceProblem as e:
        out["present"] = True
        out["hard"].append({"code": "could_not_check", "where": "variants.json", "detail": str(e)})
        out["result"] = "fail"
        return out
    if raw is None:
        return out
    out["present"] = True

    def hard(code, detail):
        out["hard"].append({"code": code, "where": "variants.json", "detail": detail})

    vs = raw.get("variants") if isinstance(raw, dict) else None
    ok = (isinstance(raw, dict) and isinstance(raw.get("kind"), str) and isinstance(raw.get("name"), str)
          and VARIANT_NAME.match(raw["name"]) and isinstance(vs, list) and 1 <= len(vs) <= 3
          and all(isinstance(v, dict) and v.get("id") in ("a", "b", "c") and isinstance(v.get("direction"), str)
                  for v in vs)
          and len({v["id"] for v in vs}) == len(vs))
    if not ok:
        hard("could_not_check", "variants.json does not have the shape of a list of up to three variants")
        out["result"] = "fail"
        return out
    kind, name = raw["kind"], raw["name"]
    if kind not in VARIANT_PLACES:
        hard("direction_unknown", "the kind in variants.json is not one the engine knows")
    else:
        dirs = ctx.directions
        if dirs is None:
            hard("could_not_check", "the list of directions could not be read")
        else:
            allowed = dirs["kinds"].get(dirs["alias"].get(kind, kind), [])
            seen = set()
            for v in vs:
                d = v["direction"]
                shown = d if NAME.match(d) else "a direction with an unusual name"
                if d in seen:
                    hard("direction_repeated", "variant %s repeats the direction %s" % (v["id"], shown))
                seen.add(d)
                if d not in allowed:
                    hard("direction_unknown", "variant %s names %s, which is not a direction for this kind"
                         % (v["id"], shown if d in sum(dirs["kinds"].values(), []) else "a direction"))
        folder, is_dir = VARIANT_PLACES[kind]
        pieces = {}
        for v in vs:
            p = os.path.join(goal, folder, "%s-%s%s" % (name, v["id"], "" if is_dir else ".md"))
            if p in by_path:
                pieces[v["id"]] = by_path[p]
            else:
                hard("could_not_check", "variant %s has no piece in %s" % (v["id"], folder))
        ids = sorted(pieces)
        pics = {}
        for i in ids:
            if pieces[i].first_picture:
                try:
                    pics[i] = grey64(pieces[i].first_picture)
                except PieceProblem:
                    pass
        text_grams = {i: grams("\n".join(t for _, t in pieces[i].texts)) for i in ids}
        from PIL import ImageChops, ImageStat
        for x in range(len(ids)):
            for y in range(x + 1, len(ids)):
                a, b = ids[x], ids[y]
                if a in pics and b in pics:
                    mean = ImageStat.Stat(ImageChops.difference(pics[a], pics[b])).mean[0]
                    if mean < ALIKE_GREY:
                        hard("variants_alike", "variants %s and %s have first pictures that differ by %.1f of 255 "
                             "on average: near copies" % (a, b, mean))
                        continue
                ga, gb = text_grams[a], text_grams[b]
                if min(len(ga), len(gb)) >= ALIKE_MIN_GRAMS:
                    share = len(ga & gb) / float(max(len(ga), len(gb)))
                    if share > ALIKE_SHARE:
                        hard("variants_alike", "variants %s and %s share %s of their word three-grams: near copies"
                             % (a, b, pct(share, 0)))
    out["result"] = "fail" if out["hard"] else "pass"
    return out


def variant_kinds(goal):
    """{piece path: kind} for the pieces variants.json names, read only to know a poster from a carousel."""
    try:
        raw = read_json(os.path.join(goal, "variants.json"), MAX_VARIANTS_JSON)
    except PieceProblem:
        return {}
    if not isinstance(raw, dict) or raw.get("kind") not in VARIANT_PLACES or not isinstance(raw.get("name"), str) \
            or not VARIANT_NAME.match(raw["name"]) or not isinstance(raw.get("variants"), list):
        return {}
    folder, is_dir = VARIANT_PLACES[raw["kind"]]
    out = {}
    for v in raw["variants"][:3]:
        if isinstance(v, dict) and v.get("id") in ("a", "b", "c"):
            out[os.path.join(goal, folder, "%s-%s%s" % (raw["name"], v["id"], "" if is_dir else ".md"))] = raw["kind"]
    return out


# --- The run -------------------------------------------------------------------------------

def find_goal(state, cwd, goal_id):
    homes = [os.path.join(state, "tasks", "company-work"), os.path.join(state, "tasks", "_proof")]
    if not isinstance(goal_id, str) or not (GOAL_ID.match(goal_id) or NAME.match(goal_id)):
        raise Problem("give the goal's identifier, such as STH-12")
    goal = os.path.join(cwd, goal_id)
    try:
        st = os.lstat(goal)
    except OSError:
        raise Problem("there is no folder %s in this folder; run the check from the task folder" % goal_id)
    if not stat.S_ISDIR(st.st_mode):
        raise Problem("%s is not a plain folder" % goal_id)
    real = os.path.realpath(goal)
    for home in homes:
        home = os.path.realpath(home)
        if os.path.dirname(real).lower() == home.lower():
            if os.path.basename(home) == "company-work" and not GOAL_ID.match(goal_id):
                break
            return real
    raise Problem("run the check from the task folder, with the goal's identifier, such as STH-12")


def find_pieces(goal):
    pieces = []
    for folder, kind, is_dir in FOLDERS:
        base = os.path.join(goal, folder)
        try:
            if not stat.S_ISDIR(os.lstat(base).st_mode):
                continue
        except OSError:
            continue
        for n, k in listing(base):
            if is_dir and k == "dir":
                pieces.append(Piece(kind, n, os.path.join(base, n), True))
            elif not is_dir and k == "file" and n.lower().endswith(".md"):
                pieces.append(Piece(kind, n[:-3], os.path.join(base, n), False))
            if len(pieces) > MAX_PIECES:
                raise Problem("the goal holds more than %d pieces; check fewer at a time" % MAX_PIECES)
    return pieces


def check(state, cwd, goal_id, deadline):
    goal = find_goal(state, cwd, goal_id)
    try:
        import PIL  # noqa: F401
    except ImportError:
        raise Problem("the drawing library is not installed; run engine/art/install.sh")
    try:
        kit = kitmod.load_kit(state)
        status = "present" if kit else "missing"
    except kitmod.KitProblem:
        kit, status = None, "unreadable"
    words = Words(load_cant_say(state), load_filler(state), kit)
    ctx = Ctx(state, kit, status, words, load_directions(), deadline)
    pieces = find_pieces(goal)
    if not pieces:
        raise Problem("found no pieces to check in %s" % goal_id)
    kinds = variant_kinds(goal)
    by_path = {}
    for p in pieces:
        if time.monotonic() > deadline:
            raise OutOfTime()
        p.variant_kind = kinds.get(p.path)
        check_piece(ctx, p)
        by_path[p.path] = p
    if status == "missing":
        pieces[0].add("kit_missing", "brand/kit.json", "there is no brand kit yet, so colours, the logo and type "
                      "were not checked; the word rules were", False)
    variants = check_variants(ctx, goal, by_path)
    return {"version": 1, "kit": status, "pieces": [p.shape() for p in pieces], "variants": variants}


def plain(report):
    lines = []
    if report["kit"] == "unreadable":
        lines.append("brand kit: could not be read, so colours, the logo and type were not checked.")
    for p in report["pieces"]:
        line = "%s/%s: %s" % (p["kind"], p["name"], p["result"])
        notes = ["%s (%s): %s" % (e["code"], e["where"], e["detail"]) for e in p["hard"] + p["soft"]]
        lines.append(line + (" - " + "; ".join(notes) if notes else "") + ".")
    v = report["variants"]
    if v["present"]:
        notes = ["%s: %s" % (e["code"], e["detail"]) for e in v["hard"]]
        lines.append("variants: %s%s." % (v["result"], " - " + "; ".join(notes) if notes else ""))
    return "\n".join(lines) + "\n"


def run(argv, cwd=None):
    """(exit code, what to print on stdout, what to print on stderr)."""
    usage = "brandcheck: give the goal's identifier, for example: brandcheck.py --json STH-12\n"
    as_json, state, goal_id, args = False, None, None, list(argv)
    while args:
        a = args.pop(0)
        if a == "--json":
            as_json = True
        elif a == "--state" and args:
            state = args.pop(0)
        elif not a.startswith("-") and goal_id is None:
            goal_id = a
        else:
            return 2, "", usage
    if goal_id is None:
        return 2, "", usage
    if state is not None and os.path.basename(HERE) == "tools":
        return 2, "", "brandcheck: --state is only for the tests; the installed check finds the state folder itself\n"
    state = os.path.realpath(state) if state else kitmod.STATE
    try:
        report = check(state, os.path.realpath(cwd or os.getcwd()), goal_id, time.monotonic() + TOTAL_SECONDS)
    except Problem as e:
        return 2, "", "brandcheck: could not check: %s.\n" % e
    except OutOfTime:
        return 2, "", "brandcheck: could not check: it took longer than %d seconds.\n" % TOTAL_SECONDS
    failed = any(p["result"] == "fail" for p in report["pieces"]) or report["variants"]["result"] == "fail"
    code = 1 if failed else 2 if report["kit"] == "unreadable" else 0
    out = json.dumps(report, ensure_ascii=False) + "\n" if as_json else plain(report)
    return code, out, ""


def out_of_time(signum, frame):
    raise OutOfTime()


def main(argv):
    signal.signal(signal.SIGALRM, out_of_time)
    signal.alarm(TOTAL_SECONDS + 5)
    try:
        code, out, err = run(argv)
    except OutOfTime:
        code, out, err = 2, "", "brandcheck: could not check: it took longer than %d seconds.\n" % TOTAL_SECONDS
    except Exception as e:   # never a trace: one line
        code, out, err = 2, "", "brandcheck: could not check: %s.\n" % type(e).__name__
    finally:
        signal.alarm(0)
    sys.stdout.write(out)
    sys.stderr.write(err)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
