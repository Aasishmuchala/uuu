#!/usr/bin/env python3
"""The brand check by code (PLAN-V5 K6): reads a goal's pieces and says, by
exact measures, where they break the brand kit, the owner's can't-say list or
the shipped list of machine-sounding filler.

    cd <task folder> && "$UUU_BRAND_PY" -I "$UUU_BRAND_CHECK" [--json] [--report] <goal id>

It writes nothing. It finds the pieces by listing the goal's folder itself
(content/*.md, drafts/*.md, slides/*/, video/*/, film/*/, site/*/; at most 40)
and never opens a path that a piece's own files name: a manifest's claims (a
company picture in a box, a logo in a box) are checked against the pixels, and
the picture a claim names is looked up by bare name in the company's files and
the room only (a film's board claims the owner's render, found in the room as
its shotlist names it: exact letter case, the shotlist's render names). Every
file is read by `lstat` first, without following a link, with a cap: text
256 KB, pictures 20 MB and 50 million pixels, a render a board claims 100 MB and
80 million pixels (the size is read from the header before anything is decoded,
and a render is made small at once). 30 seconds a piece, 120 in all.

A site (site/<name>/, PLAN-V5 K16) is read as its files, with the page viewer's
caps (300 entries, 6 names deep, 20 MB): its .html, .css, .js and .mjs files as
text, 512 KB each and 4 MB in all, by scanners that read each text once. Its
page rules: tokens_file_changed, colour_not_token, font_not_kit, text_too_small,
outside_address, no_logo, hidden_content, and the soft font_collection. What a page can do to
show other colours, faces, sizes or addresses than it writes is refused or worked
out (PLAN-V5 T58b): a filter or blend mode, color-mix() the long way round, a
style sheet or script as a data: address, <style> and <script> inside SVG read as
the browser reads them, an @font-face that gives a kit face another file, a
--brand-… token set outside kit.css, sizes through var(), calc(), rem and em, a
meta refresh, SVG animations, a logo that is hidden; and (T58e) a gradient the long
way round, attr() outside `content`, paint worklets, zoom, scales under 1 and
matrices (text drawn smaller than set), text in an SVG drawing that shrinks it,
an .svg file of the site read as markup (unless it is the kit's logo or a company
picture, byte for byte), a folder name the home server does not open, and
display or visibility set by whether the visitor asks for less motion
(hidden_content: the owner's pictures are taken with less motion asked). Every
@media, @supports, @container, @layer and @keyframes block is read like any
rule, whatever its query. `--report` (no value)
also reads viewer/<ref>/report.json of the goal for each site/<ref>/: the
smallest text the page viewer measured; a false report can only add failures.

Exit 0: every piece passes or only warns. Exit 1: a hard rule failed, including
whatever a maker can cause by what it leaves in the goal: no pieces (`no_pieces`),
more than 40 (`too_many_pieces` on the rest), a piece it cannot read or measure,
or time running out (`could_not_check` on the pieces left). Exit 2 only for a
problem with the tool itself or the kit (a bad command, a goal outside the task
folders, a kit it cannot read).

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
import bisect
import hashlib
import json
import math
import os
import re
import signal
import stat
import sys
import time
import unicodedata
from html.entities import html5 as HTML5

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
ROOM_PICTURE_BYTES = 100 * MB    # a render a film's board claims, as video.py's board and inputs take it
ROOM_PICTURE_PIXELS = 80 * 1000 * 1000
MAX_ROOM_LISTED = 20000          # entries looked at in the room (video.py's own number); a fuller room finds none
SOURCE_KEEP = 1024                 # long side of the copy of a company picture kept for later claims
# Pixels decoded or compared in one run. A source is counted once, however many claims name it. Slides and
# videos read under 700 million; a film's goal reads its twelve renders once (at 80 million pixels each, 960
# million) and the boards of its treatments: a round of three treatments of twelve square boards, with their
# render boxes, is about 110 million. That leaves room for four rounds; past it a piece is a hard
# `could_not_check`.
PIXEL_BUDGET = 1500 * 1000 * 1000

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
RENDER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,99}$")   # a shotlist's render (PLAN-V5 T41b)
NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
VARIANT_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,35}$")
GOAL_ID = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,9}-[0-9]{1,9}$")
CARDS = ("title-card", "end-card")
# Pictures and files are found by these fixed names, by lstat, exactly as the home server's preview opens them:
# this disk resolves letter case (and folds the long s) the same way for both, so what is measured is what is shown.
SLIDE_NAMES = ["slide-%02d.png" % i for i in range(1, 11)]
STILL_NAMES = ["frame-%02d.png" % i for i in range(1, 7)]
# A film's boards, s01 to s12, are taken only in exactly these names, as the home server shows them (exactlyThere).
SHOT_NAMES = ["shot-%02d.png" % i for i in range(1, 13)]
PIECE_NAMES = SLIDE_NAMES + ["poster.png", "title-card.png", "end-card.png", "contact.png", "manifest.json",
                             "slides.json", "copy.md", "shotlist.json", "words.json"]
MAX_FOLDER_ENTRIES = 2000        # a piece's folder with more entries than this is not checked
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


class Unresolved(Exception):
    """A text size the site leaves to something it never sets."""


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


def kind_at(path):
    """"file", "dir", "other" (a link, a pipe) or None, by lstat of a fixed name."""
    try:
        st = os.lstat(path)
    except OSError:
        return None
    return "file" if stat.S_ISREG(st.st_mode) else "dir" if stat.S_ISDIR(st.st_mode) else "other"


def fold(name):
    return unicodedata.normalize("NFKC", name).casefold()


def refuse_twins(folder, fixed):
    """PieceProblem when the folder holds more than one name that folds (NFKC, case) to one of the fixed names,
    so the check and the preview could open different files; or when it is too full to tell. Else the names, as
    listed, that fold to a fixed name: a fixed name among them is there in exactly that letter case."""
    want, seen, listed = {fold(n): n for n in fixed}, {}, set()
    try:
        with os.scandir(folder) as it:
            for i, e in enumerate(it):
                if i >= MAX_FOLDER_ENTRIES:
                    raise PieceProblem("a folder of this piece holds more than %d files" % MAX_FOLDER_ENTRIES)
                f = fold(e.name)
                if f in want:
                    seen[f] = seen.get(f, 0) + 1
                    if seen[f] > 1:
                        raise PieceProblem("the folder holds more than one file named like %s" % want[f])
                    listed.add(e.name)
    except OSError:
        return set()
    return listed


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


def source_picture(state, source, spend=None):
    """A company or room picture by bare name, decoded once and kept as a copy of at most SOURCE_KEEP px on its
    long side (enough for the 64 x 64 comparison); None when it is not there or cannot be read."""
    from PIL import Image

    if not isinstance(source, str) or not FILE_NAME.match(source) \
            or not source.lower().endswith(kitmod.PICTURE_ENDINGS):
        return None
    data = kitmod.find_picture_bytes(state, source, MAX_PICTURE_BYTES)
    if data is None:
        return None
    try:
        pic = kitmod.open_picture(data, "RGB", MAX_PICTURE_PIXELS)
    except ValueError:
        return None
    if spend:
        spend(pic.width * pic.height)
    if max(pic.size) > SOURCE_KEEP:
        pic.thumbnail((SOURCE_KEEP, SOURCE_KEEP), Image.BILINEAR)
    return pic


def room_picture(state, name, names, spend=None):
    """The owner's render a film's board claims, as video.py's board took it (PLAN-V5 T41b): a name of the
    shotlist's render pattern, listed in the room in exactly that letter case with no other entry in another
    case (`names`, Ctx.room_names: video.py's exactly_there, the home server's exactlyThere), a regular file
    directly in the room, not a link, at most 100 MB and 80 million pixels. Kept as a copy of at most
    SOURCE_KEEP px on its long side; None when it is not there or cannot be read."""
    room = os.path.join(state, "media", "room")
    if not isinstance(name, str) or not RENDER_NAME.match(name) or not names or names.get(name.lower()) != [name]:
        return None
    path = os.path.join(room, name)     # no slash in the pattern: directly in the room
    try:
        st = os.lstat(path)
        if not stat.S_ISREG(st.st_mode) or st.st_size > ROOM_PICTURE_BYTES:
            return None
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    except OSError:
        return None
    with os.fdopen(fd, "rb") as fh:
        fs = os.fstat(fd)
        if not stat.S_ISREG(fs.st_mode) or (fs.st_dev, fs.st_ino) != (st.st_dev, st.st_ino) \
                or fs.st_size > ROOM_PICTURE_BYTES:
            return None
        return decode_small(fh, ROOM_PICTURE_PIXELS, spend)


def decode_small(fh, max_pixels, spend=None):
    """A picture read from an open file and kept small: its size is read from the header and one over
    `max_pixels` is refused before anything is decoded (Pillow's own guard is set to the same number); a JPEG is
    decoded at a half, a quarter or an eighth of its size when that still covers the copy; the pixels decoded
    are charged before they are; then the copy of at most SOURCE_KEEP px is made at once and the full picture
    let go, so one full-size picture at most is ever held. None when it cannot be read."""
    from PIL import Image
    import warnings

    saved = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = max_pixels
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            im = Image.open(fh, formats=kitmod.PICTURE_FORMATS)
            w, h = im.size
            if w < 1 or h < 1 or w * h > max_pixels:
                return None
            im.draft(None, (SOURCE_KEEP, SOURCE_KEEP))
            if spend:
                spend(im.width * im.height)
            im.load()
            return small_copy(im)
    except PieceProblem:
        raise
    except Exception:   # a bomb, a damaged file, a format or mode the board could not have taken either
        return None
    finally:
        Image.MAX_IMAGE_PIXELS = saved


def small_copy(im):
    """An RGB copy of at most SOURCE_KEEP px on its long side, the colours taken as video.py's board takes them
    (an alpha band is dropped, never weighed in). Pillow makes a second full-size picture to resize one with an
    alpha band, so such a picture is resized band by band; every other is resized in place."""
    from PIL import Image

    keep = (SOURCE_KEEP, SOURCE_KEEP)
    if im.mode in ("RGBA", "LA"):
        bands = []
        for i in range(len(im.mode) - 1):
            band = im.getchannel(i)
            band.thumbnail(keep, Image.BILINEAR)
            bands.append(band)
        return Image.merge("RGB", bands * 3 if len(bands) == 1 else bands)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")      # a palette, 16-bit or CMYK picture
    im.thumbnail(keep, Image.BILINEAR)
    return im.convert("RGB")


def claim_holds(state, im, box, source, spend=None, pic=None):
    """True when the picture named by bare name, cover-fitted to the box, is what the box shows. Both sides
    are resized straight to 64 x 64 from their own pixels: no picture larger than the slide or the source.
    `pic` is the source already opened (Ctx.source keeps one copy per name for the whole run)."""
    from PIL import Image, ImageChops

    if pic is None:
        pic = source_picture(state, source, spend)
    if pic is None:
        return False
    w, h = box[2] - box[0], box[3] - box[1]
    size = (CLAIM_SIZE, CLAIM_SIZE)
    want = pic.resize(size, Image.BILINEAR, box=kitmod.cover_rect(pic.width, pic.height, w, h))
    got = im.resize(size, Image.BILINEAR, box=box)
    r, g, b = ImageChops.difference(want, got).split()
    worst = ImageChops.lighter(ImageChops.lighter(r, g), b)
    agree = worst.point(lambda v: 255 if v <= CLAIM_PIXEL else 0).histogram()[255]
    return agree >= CLAIM_SHARE * CLAIM_SIZE * CLAIM_SIZE


def logo_difference(im, box, mark):
    """Mean difference (0-255) between the box and the logo file scaled to it, over the logo's opaque pixels."""
    from PIL import Image, ImageChops, ImageStat

    w, h = box[2] - box[0], box[3] - box[1]
    s = min(1.0, LOGO_COMPARE_MAX / float(max(w, h)))
    if s < 1:   # a large box: both sides straight to the comparison size, nothing the size of the box is made
        size = (max(1, int(w * s)), max(1, int(h * s)))
        crop, scaled = im.resize(size, Image.BOX, box=box), mark.resize(size, Image.LANCZOS)
    else:
        crop, scaled = im.crop(box), mark.resize((w, h), Image.LANCZOS)
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
        self.report = False     # --report: a site's text sizes from the page viewer's report too
        self.logos = None
        self.pixels = 0
        self.sources = {}
        self.room = None

    def source(self, name, room=False):
        """Each company picture, or each render a board claims, is opened and charged once a run; later claims
        reuse the kept copy (one full-size picture at a time, never more)."""
        key = (room, name if isinstance(name, str) else None)
        if key not in self.sources:
            self.sources[key] = (room_picture(self.state, name, self.room_names(), self.spend) if room
                                 else source_picture(self.state, name, self.spend))
        return self.sources[key]

    def room_names(self):
        """{name in lower case: [names as listed]} of the room, listed once a run; {} when the room is a link, is
        not there, cannot be listed or holds more than MAX_ROOM_LISTED entries (no render is found then)."""
        if self.room is None:
            self.room, names = {}, {}
            room = os.path.join(self.state, "media", "room")
            if kind_at(room) == "dir":
                try:
                    with os.scandir(room) as it:
                        for i, e in enumerate(it):
                            if i >= MAX_ROOM_LISTED:
                                return self.room
                            names.setdefault(e.name.lower(), []).append(e.name)
                except OSError:
                    return self.room
                self.room = names
        return self.room

    def spend(self, n):
        """Counts pixels decoded or compared; past the budget the piece cannot be checked (a hard result)."""
        self.pixels += n
        if self.pixels > PIXEL_BUDGET:
            raise PieceProblem("its pictures are more than the check measures in one run (%d million pixels)"
                               % (PIXEL_BUDGET // 1000000))

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
        self.deadline = float("inf")

    def add(self, code, where, detail, hard=True):
        (self.hard if hard else self.soft).append({"code": code, "where": where, "detail": detail})

    def tick(self):
        now = time.monotonic()
        if now - self.started > PIECE_SECONDS or now > self.deadline:
            raise PieceProblem("it took longer than the check allows (%d seconds a piece, %d in all)"
                               % (PIECE_SECONDS, TOTAL_SECONDS))

    def result(self):
        return "fail" if self.hard else "warn" if self.soft else "pass"

    def shape(self):
        return {"kind": self.kind, "name": safe(self.name), "result": self.result(), "hard": listed(self.hard),
                "soft": listed(self.soft), "measured": self.measured}


def listed(entries):
    """At most LISTED entries, the last saying how many more there were: the home server reads at most 50 of a
    kind in a piece and refuses a longer list whole."""
    if len(entries) <= LISTED:
        return entries
    rest = entries[LISTED - 1:]
    return entries[:LISTED - 1] + [{"code": rest[0]["code"], "where": rest[0]["where"],
                                    "detail": "and %d more problems were not listed" % len(rest)}]


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


def check_pictures(ctx, piece, pictures, pics, logos, required, soft_palette=(), room=False):
    """pictures: [(label, file name, path)] (label: a slide number or a frame name). Claims, logo, palette.
    A picture whose label is in `soft_palette` (a film's poster: Runway's footage) only warns off the palette.
    With `room` (a film's boards) each claim's source is the owner's render in the room (room_picture)."""
    what = "the render" if room else "the company picture"
    counts, total_pixels = {}, 0
    found = set()
    for label, fname, path in pictures:
        piece.tick()
        im = read_picture(path)
        ctx.spend(im.width * im.height)
        exempt = []
        key = "slide" if isinstance(label, int) else "frame"
        for c in pics:
            if c.get(key) != label:
                continue
            box = check_box(c.get("box"), im.size)      # a claimed box is never larger than the picture
            if box is None:
                piece.add("picture_claim_false", fname, "a picture box in the manifest is not a box inside the picture")
                continue
            ctx.spend((box[2] - box[0]) * (box[3] - box[1]))
            pic = ctx.source(c.get("source"), room)
            if pic is not None and claim_holds(ctx.state, im, box, c.get("source"), pic=pic):
                exempt.append(box)
            else:
                piece.add("picture_claim_false", fname, "the box at %d, %d (%d × %d) does not show %s %s"
                          % (box[0], box[1], box[2] - box[0], box[3] - box[1], what, safe(c.get("source"))))
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
                ctx.spend((box[2] - box[0]) * (box[3] - box[1]) * max(1, len(ctx.kit.logo_files)))
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
                if label in soft_palette:
                    detail += "; it is a frame of the film's footage, so this only warns"
                piece.add("off_palette", fname, detail, share >= OFF_HARD and label not in soft_palette)
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


# --- Pages (PLAN-V5 K16, T51) ----------------------------------------------------------------
#
# A site piece (site/<name>/ or site/<name>-<id>/) is checked from its own files: its pages, style sheets and
# scripts read as text, nothing run and nothing fetched. Every scanner reads its text once, left to right, with
# str.find and with patterns matched at one place that consume what they match (their alternatives start on
# different characters, and the only repeat is last), so nothing is read again after a pattern stops: hostile
# text costs time in proportion to its length, and the caps bound the length. (A <style> or <script> after an
# <svg> or <math> is read twice: as raw text and as markup.) Brackets are counted in lists,
# never by recursion.

SITE_ENTRIES = 300               # files and folders, as the page viewer takes a site
SITE_SEGMENTS = 6                # names deep, the file's own included (the viewer's rule)
SITE_BYTES = 20 * MB
PAGE_TEXT_BYTES = 512 * KB       # one page, style sheet or script
SITE_TEXT_BYTES = 4 * MB         # all of a site's
SITE_WORDS = MAX_TEXT_BYTES      # the words of a site's pages that the word rules read
REPORT_BYTES = 512 * KB          # viewer/<ref>/report.json, as the home server reads the viewer's answer
REPORT_PAGES = 10
REPORT_FONTS = 50
MAX_REFS = 40                    # pictures looked at in the first page's header
PER_CODE = 6                     # entries listed for one rule on one site; the rest are counted in one more
LISTED = 48                      # entries of one kind in a piece's answer (the home server reads at most 50)
FONT_TOKENS = 64
CAPTURE_TOKENS = 24
PAGE_ENDINGS = ("html", "css", "js", "mjs", "svg")      # T58e: an SVG picture the site holds is read as markup
OWN_FILES = "a page may use only its own files"
KIT_COLOURS = "use the brand kit's var(--brand-…) colours"

HEXDIGITS = "0123456789abcdefABCDEF"
CONTROL = "".join(chr(c) for c in range(0x21))
DROP_TAB_NL = {9: None, 10: None, 13: None}
ASCII_LOWER = {c: c + 32 for c in range(65, 91)}
SCHEME = re.compile(r"([a-z][a-z0-9+.-]{0,30}):")
OUTSIDE_SCHEMES = ("http", "https", "ws", "wss", "ftp")
PERCENT = re.compile(r"%([0-9a-fA-F]{2})")

# The CSS colour names, and the system colours a page can name.
NAMED_COLOURS = dict((n, kitmod.rgb_of("#" + h)) for n, h in (x.split(":") for x in """
aliceblue:F0F8FF antiquewhite:FAEBD7 aqua:00FFFF aquamarine:7FFFD4 azure:F0FFFF beige:F5F5DC bisque:FFE4C4
black:000000 blanchedalmond:FFEBCD blue:0000FF blueviolet:8A2BE2 brown:A52A2A burlywood:DEB887 cadetblue:5F9EA0
chartreuse:7FFF00 chocolate:D2691E coral:FF7F50 cornflowerblue:6495ED cornsilk:FFF8DC crimson:DC143C cyan:00FFFF
darkblue:00008B darkcyan:008B8B darkgoldenrod:B8860B darkgray:A9A9A9 darkgreen:006400 darkgrey:A9A9A9
darkkhaki:BDB76B darkmagenta:8B008B darkolivegreen:556B2F darkorange:FF8C00 darkorchid:9932CC darkred:8B0000
darksalmon:E9967A darkseagreen:8FBC8F darkslateblue:483D8B darkslategray:2F4F4F darkslategrey:2F4F4F
darkturquoise:00CED1 darkviolet:9400D3 deeppink:FF1493 deepskyblue:00BFFF dimgray:696969 dimgrey:696969
dodgerblue:1E90FF firebrick:B22222 floralwhite:FFFAF0 forestgreen:228B22 fuchsia:FF00FF gainsboro:DCDCDC
ghostwhite:F8F8FF gold:FFD700 goldenrod:DAA520 gray:808080 green:008000 greenyellow:ADFF2F grey:808080
honeydew:F0FFF0 hotpink:FF69B4 indianred:CD5C5C indigo:4B0082 ivory:FFFFF0 khaki:F0E68C lavender:E6E6FA
lavenderblush:FFF0F5 lawngreen:7CFC00 lemonchiffon:FFFACD lightblue:ADD8E6 lightcoral:F08080 lightcyan:E0FFFF
lightgoldenrodyellow:FAFAD2 lightgray:D3D3D3 lightgreen:90EE90 lightgrey:D3D3D3 lightpink:FFB6C1
lightsalmon:FFA07A lightseagreen:20B2AA lightskyblue:87CEFA lightslategray:778899 lightslategrey:778899
lightsteelblue:B0C4DE lightyellow:FFFFE0 lime:00FF00 limegreen:32CD32 linen:FAF0E6 magenta:FF00FF maroon:800000
mediumaquamarine:66CDAA mediumblue:0000CD mediumorchid:BA55D3 mediumpurple:9370DB mediumseagreen:3CB371
mediumslateblue:7B68EE mediumspringgreen:00FA9A mediumturquoise:48D1CC mediumvioletred:C71585
midnightblue:191970 mintcream:F5FFFA mistyrose:FFE4E1 moccasin:FFE4B5 navajowhite:FFDEAD navy:000080
oldlace:FDF5E6 olive:808000 olivedrab:6B8E23 orange:FFA500 orangered:FF4500 orchid:DA70D6 palegoldenrod:EEE8AA
palegreen:98FB98 paleturquoise:AFEEEE palevioletred:DB7093 papayawhip:FFEFD5 peachpuff:FFDAB9 peru:CD853F
pink:FFC0CB plum:DDA0DD powderblue:B0E0E6 purple:800080 rebeccapurple:663399 red:FF0000 rosybrown:BC8F8F
royalblue:4169E1 saddlebrown:8B4513 salmon:FA8072 sandybrown:F4A460 seagreen:2E8B57 seashell:FFF5EE
sienna:A0522D silver:C0C0C0 skyblue:87CEEB slateblue:6A5ACD slategray:708090 slategrey:708090 snow:FFFAFA
springgreen:00FF7F steelblue:4682B4 tan:D2B48C teal:008080 thistle:D8BFD8 tomato:FF6347 turquoise:40E0D0
violet:EE82EE wheat:F5DEB3 white:FFFFFF whitesmoke:F5F5F5 yellow:FFFF00 yellowgreen:9ACD32
canvas:FFFFFF canvastext:000000 linktext:0000EE visitedtext:551A8B activetext:FF0000 buttonface:EFEFEF
buttontext:000000 buttonborder:767676 field:FFFFFF fieldtext:000000 highlight:B5D5FF highlighttext:000000
selecteditem:0075FF selecteditemtext:FFFFFF mark:FFFF00 marktext:000000 graytext:808080 accentcolor:0075FF
accentcolortext:FFFFFF
""".split()))
COLOUR_FUNCS = ("rgb", "rgba", "hsl", "hsla", "hwb")                  # read and compared with the kit
UNREAD_FUNCS = ("lab", "lch", "oklab", "oklch", "color")               # colours the check does not read: refused
URL_FUNCS = ("url", "src", "image", "image-set", "-webkit-image-set")  # a string in these is an address
# Properties whose words are names, never colours (an animation called "tomato" is not a colour).
NAME_PROPS = frozenset("""font-family font animation animation-name transition transition-property will-change
grid grid-area grid-row grid-column grid-row-start grid-row-end grid-column-start grid-column-end grid-template
grid-template-areas grid-template-columns grid-template-rows counter-reset counter-increment counter-set container
container-name view-transition-name view-transition-class anchor-name position-anchor list-style list-style-type
timeline-scope scroll-timeline scroll-timeline-name view-timeline view-timeline-name animation-timeline page
content quotes font-palette font-feature-settings font-variant-alternates string-set""".split())
FONT_PROPS = ("font-family", "font", "font-size")
WIDE = ("inherit", "initial", "unset")
BRAND_FACES = ("--brand-heading", "--brand-body")
FALLBACKS = ("serif", "sans-serif", "monospace")
FONT_LEAD = frozenset("""normal italic oblique bold bolder lighter small-caps ultra-condensed extra-condensed
condensed semi-condensed semi-expanded expanded extra-expanded ultra-expanded""".split())
FONT_SIZES = frozenset("xx-small x-small small medium large x-large xx-large xxx-large smaller larger math".split())
SYSTEM_FONTS = ("caption", "icon", "menu", "message-box", "small-caption", "status-bar")
ANGLES = ("deg", "rad", "grad", "turn")
# Sizes in px: absolute units; units of the root's size (em and % taken against the root too, ex and ch as half an
# em); the size keywords as Chrome draws them. A unit of the screen (vw, vh, ...) is not read.
ABS_UNITS = {"px": 1.0, "pt": 4 / 3, "pc": 16.0, "in": 96.0, "cm": 96 / 2.54, "mm": 96 / 25.4, "q": 96 / 101.6}
ROOT_UNITS = {"rem": 1.0, "em": 1.0, "%": 0.01, "ex": 0.5, "rex": 0.5, "ch": 0.5, "rch": 0.5, "cap": 0.7,
              "rcap": 0.7, "ic": 1.0, "ric": 1.0, "lh": 1.2, "rlh": 1.2}
SIZE_WORDS = {"xx-small": 9.0, "x-small": 10.0, "small": 13.0, "medium": 16.0, "large": 18.0, "x-large": 24.0,
              "xx-large": 32.0, "xxx-large": 48.0}
ROOT_PX = 16.0                   # the root's size when the site sets none
VAR_DEPTH = 8                    # var() inside var() followed this deep
CUSTOM_DEFS = 16                 # values of one custom property kept
CUSTOM_NAMES = 2000
ROOT_SELECTOR = re.compile(r"(?:^|[\s,>~+(])(?:html|:root)(?![\w-])")
# What changes every colour a page draws, so that no colour written can be compared with the kit.
FILTER_PROPS = ("filter", "-webkit-filter", "backdrop-filter", "-webkit-backdrop-filter")
FILTER_SAFE = ("blur", "opacity", "drop-shadow")
BLEND_PROPS = ("mix-blend-mode", "background-blend-mode")
NO_EFFECT = ("none", "normal", "inherit", "initial", "unset", "revert", "revert-layer")
LONG_HUES = ("longer", "increasing", "decreasing")       # color-mix() or a gradient the long way round the hue wheel
# T58e: what draws text smaller than it is set, what draws with a script, and what shows another page to visitors
# who do not ask for less motion than the page viewer's pictures are taken with.
SCALE_FUNCS = ("scale", "scalex", "scaley", "scalez", "scale3d")
MATRIX_FUNCS = ("matrix", "matrix3d")
TRANSFORM_PROPS = ("transform", "-webkit-transform")
SHRINK = ("text_too_small", "%s, which draws text smaller than its size; the check does not let text be drawn "
          "smaller than it is set")
WORKLETS = frozenset(("paintWorklet", "animationWorklet", "layoutWorklet", "registerPaint", "registerAnimator",
                      "registerLayout"))
WORKLET = ("a paint worklet, which draws with a script the check does not read, so its colours cannot be compared "
           "with the kit; %s")
MOTION = "prefers-reduced-motion"
SHOW_PROPS = ("display", "visibility", "content-visibility")
SVG_TEXT = ("text", "tspan", "textpath", "foreignobject")
SITE_FOLDER = re.compile(r"^[a-z0-9][a-z0-9-]{0,35}$")    # the home server's own rule for a site's folder
FILTERED = ("a filter, which changes every colour the page draws so that none can be compared with the kit; "
            "use the brand kit's colours as they are")
BLENDED = ("a blend mode, which mixes colours into ones the check cannot compare with the kit; use the brand kit's "
           "colours as they are")

# HTML attributes that hold an address the page fetches (href only off <a> and <area>, which are links).
URL_ATTRS = ("src", "srcset", "poster", "data", "action", "formaction", "background", "ping", "manifest",
             "imagesrcset", "href", "xlink:href")
LINK_TAGS = ("a", "area")
SVG_COLOUR_ATTRS = ("fill", "stroke", "stop-color", "flood-color", "lighting-color")
LEGACY_COLOUR_TAGS = ("font", "hr", "basefont")
BODY_COLOUR_ATTRS = ("text", "link", "vlink", "alink")
WORD_ATTRS = ("alt", "title", "aria-label", "placeholder")
RAW_TAGS = ("script", "style", "textarea", "title", "xmp", "noembed", "noframes", "noscript", "iframe")
FOREIGN_TAGS = ("svg", "math")      # in them <style> and <script> are markup: references decoded, tags inside
VOID_TAGS = frozenset("area base br col embed hr img input link meta source track wbr param keygen".split())
SMIL_TAGS = ("set", "animate", "animatecolor", "animatemotion", "animatetransform")
SMIL_VALUES = ("to", "from", "by", "values")
DATA_TAGS = ("iframe", "frame", "object", "embed", "script")    # a data: address here is a page or script of its own
HEADER_STACK = 256
BLOCK_TAGS = frozenset("""p div br li ul ol dl dt dd h1 h2 h3 h4 h5 h6 header footer main section article aside
nav figure figcaption blockquote pre table tr td th caption form fieldset legend label button option hr address
details summary dialog""".split())
JS_TYPES = ("", "module", "text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript",
            "application/x-javascript", "text/jscript", "text/livescript")
JS_LIST_TYPES = ("importmap", "speculationrules")     # every string in them is an address
JS_CALLEES = ("fetch", "import", "importScripts", "Worker", "SharedWorker", "WebSocket", "EventSource",
              "sendBeacon", "open", "Request")
JS_BEFORE_EXPR = frozenset("""return typeof instanceof in of new delete void throw case do else yield await""".split())

CSS_START = r"(?:[A-Za-z_]|[^\x00-\x7f]|\\[^\n\r\f])"
CSS_NAME = r"(?:[A-Za-z0-9_-]|[^\x00-\x7f]|\\[^\n\r\f])"
CSS_TOKEN = re.compile(r"(?P<ws>[\t\n\f\r ]+)|(?P<cm>/\*)|(?P<q>[\"'])"
                       r"|(?P<id>(?:--|-?" + CSS_START + r")" + CSS_NAME + r"*)"
                       r"|(?P<hash>#" + CSS_NAME + r"+)"
                       r"|(?P<num>[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)"
                       r"|(?P<at>@(?:--|-?" + CSS_START + r")" + CSS_NAME + r"*)"
                       r"|(?P<other>.)", re.S)
CSS_UNIT = re.compile(r"%|-?" + CSS_START + CSS_NAME + r"*")
CSS_WS = re.compile(r"[\t\n\f\r ]*")
CSS_STR = {'"': re.compile(r'[^"\\\n\r\f]*'), "'": re.compile(r"[^'\\\n\r\f]*")}
CSS_ESCAPE = re.compile(r"\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[\t\n\f\r ])?|(\r\n|[\n\r\f])|(.))", re.S)

HTML_WS = re.compile(r"[\t\n\f\r ]*")
HTML_GAP = re.compile(r"[\t\n\f\r /]*")
TAG_NAME = re.compile(r"[A-Za-z][^\t\n\f\r />]*")
ATTR_NAME = re.compile(r"[^\t\n\f\r />][^\t\n\f\r />=]*")
ATTR_VALUE = re.compile(r"[^\t\n\f\r >]*")
TAG_END = "\t\n\f\r />"
ENTITY = re.compile(r"&(#[xX]0*[0-9a-fA-F]{1,8}|#0*[0-9]{1,10}|[A-Za-z][A-Za-z0-9]{0,31})(;?)")

JS_ID = r"(?:[A-Za-z_$]|[^\x00-\x7f]|\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\}))"
JS_TOKEN = re.compile(r"(?P<ws>\s+)|(?P<lc>//)|(?P<bc>/\*)|(?P<q>[\"'`])"
                      r"|(?P<id>" + JS_ID + r"(?:[0-9]|" + JS_ID + r")*)"
                      r"|(?P<num>\.?[0-9][A-Za-z0-9_.]*)"
                      r"|(?P<p>\?\.(?![0-9])|[(){}\[\];,])"
                      r"|(?P<other>.)", re.S)
JS_STR = {'"': re.compile(r'[^"\\\n\r]*'), "'": re.compile(r"[^'\\\n\r]*")}
JS_TPL = re.compile(r"[^`\\$]*")
JS_RE_CHUNK = re.compile(r"[^\\/\[\]\n\r]*")
JS_FLAGS = re.compile(r"[A-Za-z]*")
JS_ESCAPE = re.compile(r"\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|u\{0*([0-9a-fA-F]{1,6})\}"
                       r"|(\r\n|[\n\r\u2028\u2029])|(.))", re.S)
JS_SIMPLE = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}


def code_point(n):
    return chr(n) if 0 < n <= 0x10FFFF and not 0xD800 <= n <= 0xDFFF else "\ufffd"


def _entity(m):
    body, semi = m.group(1), m.group(2)
    if body[0] == "#":
        return code_point(int(body[2:], 16) if body[1] in "xX" else int(body[1:]))
    if semi and body + ";" in HTML5:
        return HTML5[body + ";"]
    for k in range(len(body), 1, -1):        # a legacy name needs no semicolon: the longest one that fits
        if body[:k] in HTML5:
            return HTML5[body[:k]] + body[k:] + semi
    return m.group(0)


def unescape_html(s):
    """Character references decoded as a browser decodes them (bounded digits: never a huge number)."""
    return ENTITY.sub(_entity, s) if "&" in s else s


def _css_escape(m):
    if m.group(1):
        return code_point(int(m.group(1), 16))
    return "" if m.group(2) else m.group(3)


def css_unescape(s):
    return CSS_ESCAPE.sub(_css_escape, s) if "\\" in s else s


def _js_escape(m):
    h = m.group(1) or m.group(2) or m.group(3)
    if h:
        return code_point(int(h, 16)) if int(h, 16) else "\0"
    if m.group(4):
        return ""
    return JS_SIMPLE.get(m.group(5), m.group(5))


def js_unescape(s):
    return JS_ESCAPE.sub(_js_escape, s) if "\\" in s else s


def is_outside(url):
    """True for an address that leaves the site: http, https, ws, wss, ftp or //, read as a browser reads it
    (leading spaces and controls dropped, tabs and line breaks removed, a backslash taken as a slash)."""
    u = url.translate(DROP_TAB_NL).lstrip(CONTROL)[:40].lower().replace("\\", "/")
    if u.startswith("//"):
        return True
    m = SCHEME.match(u)
    return m is not None and m.group(1) in OUTSIDE_SCHEMES


def site_ref(value):
    """The site file a reference from the top page names, or None: no scheme, query or fragment; dot segments
    resolved as a browser resolves them (never above the top)."""
    v = value.translate(DROP_TAB_NL).strip(CONTROL).replace("\\", "/")
    if v.startswith("//") or SCHEME.match(v[:40].lower()):
        return None
    for cut in "?#":
        v = v.split(cut, 1)[0]
    v = PERCENT.sub(lambda m: chr(int(m.group(1), 16)), v)
    parts = []
    for seg in v.split("/", 64)[:64]:
        if seg in ("", "."):
            continue
        if seg == "..":
            if parts:
                parts.pop()
            continue
        parts.append(seg)
    return "/".join(parts)


def shown_path(name):
    """A site file's path as a detail may name it: every name in it by K6's pattern, else the fixed words."""
    return name if len(name) <= 100 and all(FILE_NAME.match(p) for p in name.split("/")) else UNUSUAL


def decode_page(data):
    """A page's text, by its byte order mark as a browser decodes it (one wins over the served charset)."""
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16", errors="replace")
    return data.decode("utf-8-sig" if data[:3] == b"\xef\xbb\xbf" else "utf-8", errors="replace")


REFRESH = re.compile(r"[\t\n\f\r ]*[0-9.]*[\t\n\f\r ]*[;,]?[\t\n\f\r ]*(?:[uU][rR][lL][\t\n\f\r ]*=[\t\n\f\r ]*)?")


def refresh_url(content):
    """The address of a meta refresh's content, as a browser reads it ("5; url='next.html'")."""
    u = content[REFRESH.match(content).end():]
    if u[:1] in ("'", '"'):
        u = u[1:].split(u[0], 1)[0]
    return u


def is_data(url):
    return url.translate(DROP_TAB_NL).lstrip(CONTROL)[:5].lower() == "data:"


def data_text(url):
    """The text a data: address holds (percent or base64), as a browser decodes it; "" when it holds none."""
    import base64
    import binascii

    u = url.translate(DROP_TAB_NL).strip(CONTROL)
    meta, sep, body = u[5:].partition(",")
    if not sep:
        return ""
    raw = PERCENT.sub(lambda m: chr(int(m.group(1), 16)), body).encode("latin-1", errors="replace")
    if meta.lower().replace(" ", "").endswith(";base64"):
        b = bytes(c for c in raw if c not in b" \t\n\f\r")
        try:
            raw = base64.b64decode(b + b"=" * (-len(b) % 4))
        except (binascii.Error, ValueError):
            return ""
    return decode_page(raw)


def foreign_text(text, low, i, name):
    """(the text of a <style> or <script> inside SVG or MathML from i, as the browser builds it: references
    decoded, CDATA kept, comments and tags left out; where its end tag starts). Read once, left to right."""
    out, n, end_tag = [], len(text), "</" + name
    while i < n:
        j = text.find("<", i)
        if j < 0:
            out.append(unescape_html(text[i:]))
            break
        if j > i:
            out.append(unescape_html(text[i:j]))
        if text.startswith("<![CDATA[", j):
            k = text.find("]]>", j + 9)
            out.append(text[j + 9:n if k < 0 else k])
            i = n if k < 0 else k + 3
        elif text.startswith("<!--", j):
            k = text.find("-->", j + 4)
            i = n if k < 0 else k + 3
        elif low.startswith(end_tag, j) and (j + len(end_tag) >= n or text[j + len(end_tag)] in TAG_END):
            return "".join(out), j
        elif TAG_NAME.match(text, j + 1) or text[j + 1:j + 2] in ("/", "!", "?"):
            k = text.find(">", j + 1)
            i = n if k < 0 else k + 1
        else:
            out.append("<")
            i = j + 1
    return "".join(out), n


def _number(v):
    m = re.match(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)", v[:40])
    return float(m.group()) if m else None


def hides(name, attrs):
    """True when an element's own attributes keep it from being seen: hidden, a width or height of at most one
    pixel, or a style attribute that takes it away, makes it see-through or moves, clips or masks it."""
    seen = {}
    for a, raw, _ in attrs:
        seen.setdefault(a, raw)
    if "hidden" in seen:
        return True
    for a in ("width", "height"):
        if a in seen:
            v = _number(unescape_html(seen[a]).strip(" \t\n\f\r"))
            if v is not None and v <= 1:
                return True
    style = seen.get("style")
    if style is None:
        return False
    s = css_unescape(unescape_html(style)).translate(ASCII_LOWER)
    parts, i = [], 0
    while True:                          # comments out, read once
        j = s.find("/*", i)
        if j < 0:
            parts.append(s[i:])
            break
        parts.append(s[i:j])
        k = s.find("*/", j + 2)
        if k < 0:
            break
        i = k + 2
    for decl in "".join(parts).split(";"):
        prop, colon, value = decl.partition(":")
        if not colon:
            continue
        prop = prop.strip(" \t\n\f\r")
        value = value.replace("!important", "").strip(" \t\n\f\r")
        if prop == "display" and value == "none" or prop == "visibility" and value in ("hidden", "collapse") \
                or prop == "content-visibility" and value == "hidden":
            return True
        if prop == "opacity":
            v = _number(value)
            if v is not None and (v / 100 if value.endswith("%") else v) < 0.1:
                return True
        if prop in ("width", "height", "max-width", "max-height", "inline-size", "block-size", "max-inline-size",
                    "max-block-size"):
            v = _number(value)
            if v is not None and (v <= 0 or v <= 1 and value.lstrip("+-0123456789.") in ("", "px")):
                return True
        if prop == "zoom":
            v = _number(value)
            if v is not None and (v / 100 if value.endswith("%") else v) < 0.1:
                return True
        if prop in ("clip", "clip-path", "transform", "translate", "scale", "filter") or prop.startswith(
                ("mask", "-webkit-mask")):
            if value not in NO_EFFECT:
                return True
        if prop in ("left", "top", "right", "bottom", "inset", "margin", "margin-left", "margin-top",
                    "margin-right", "margin-bottom", "text-indent") and value.startswith("-"):
            return True
    return False


def interval(a, b, op):
    """Two (smallest, largest, is a length) values put together by +, -, * or / as calc() does; None when CSS
    would not take them (a length times a length, a length added to a number, dividing by a length or by 0)."""
    if op in "+-":
        if a[2] != b[2]:
            return None
        return (a[0] + b[0], a[1] + b[1], a[2]) if op == "+" else (a[0] - b[1], a[1] - b[0], a[2])
    if op == "*":
        if a[2] and b[2]:
            return None
        ends = [x * y for x in a[:2] for y in b[:2]]
    else:
        if b[2] or b[0] <= 0 <= b[1]:
            return None
        ends = [a[0] / b[0], a[0] / b[1], a[1] / b[0], a[1] / b[1]]
    if any(e != e for e in ends):
        return None
    return (min(ends), max(ends), a[2] or b[2])


def hex_rgb(h):
    if len(h) not in (3, 4, 6, 8) or any(c not in HEXDIGITS for c in h):
        return None
    if len(h) <= 4:
        return tuple(int(c, 16) * 17 for c in h[:3])
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def legacy_colour(value):
    """The colour HTML makes of a legacy colour attribute (bgcolor, <font color>): any text gives one."""
    v = value.strip(" \t\n\f\r")
    if not v or v.lower() == "transparent":
        return None
    if v.lower() in NAMED_COLOURS:
        return NAMED_COLOURS[v.lower()]
    if len(v) == 4 and v[0] == "#" and all(c in HEXDIGITS for c in v[1:]):
        return tuple(int(c, 16) * 17 for c in v[1:])
    s = "".join("00" if ord(c) > 0xFFFF else c for c in v[:128])[:128]
    s = "".join(c if c in HEXDIGITS else "0" for c in (s[1:] if s.startswith("#") else s))
    while not s or len(s) % 3:
        s += "0"
    n = len(s) // 3
    parts = [s[:n], s[n:2 * n], s[2 * n:]]
    if n > 8:
        parts, n = [p[-8:] for p in parts], 8
    while n > 2 and all(p[0] == "0" for p in parts):
        parts, n = [p[1:] for p in parts], n - 1
    return tuple(int(p[:2], 16) for p in parts)


def colour_function(name, toks, kit_names):
    """rgb(), rgba(), hsl(), hsla() or hwb() from its tokens [(depth, kind, value)] (depth 0: its own arguments):
    (r, g, b); True for the kit's own colour with any alpha (`from var(--brand-<name>) r g b / a`); None when
    the check cannot read it."""
    import colorsys

    if any(t[0] == "over" for t in toks):
        return None
    if toks and toks[0][1:] == ("id", "from"):
        same = {"rgb": "rgb", "rgba": "rgb", "hsl": "hsl", "hsla": "hsl", "hwb": "hwb"}[name]
        if len(toks) < 6 or toks[1][1:] != ("fn", "var") or toks[2][:2] != (1, "id") \
                or css_unescape(toks[2][2]) not in kit_names:
            return None
        chans = [css_unescape(t[2]).lower() if t[1] == "id" else None for t in toks[3:6]]
        rest = toks[6:]
        if [t[0] for t in toks[3:6]] != [0, 0, 0] or chans != list(same) \
                or (rest and rest[0][1:] != ("other", "/")):
            return None
        return True
    args = []
    for d, kind, tok in toks:
        if d != 0 or kind == "fn":
            return None
        if kind == "num":
            args.append(tok)
        elif kind == "id" and css_unescape(tok).lower() == "none":
            args.append((0.0, ""))
        elif kind == "other" and tok in ",/":
            args.append(tok)
        else:
            return None
    if "/" in args:
        chans = [a for a in args[:args.index("/")] if a != ","]
    else:
        chans = [a for a in args if a != ","][:3]
    if len(chans) != 3 or any(not isinstance(a, tuple) or not math.isfinite(a[0]) for a in chans):
        return None

    def part(v, unit, scale):     # a percentage or a plain number, as a share of 1
        if unit == "%":
            return min(1.0, max(0.0, v / 100.0))
        return min(1.0, max(0.0, v / scale)) if unit == "" else None

    def hue(v, unit):
        f = {"": 1.0, "deg": 1.0, "rad": 180.0 / math.pi, "grad": 0.9, "turn": 360.0}.get(unit)
        return None if f is None else (v * f % 360.0) / 360.0

    if name in ("rgb", "rgba"):
        out = [part(v, u, 255.0) for v, u in chans]
    else:
        h, a, b = hue(*chans[0]), part(*chans[1], scale=100.0), part(*chans[2], scale=100.0)
        if None in (h, a, b):
            return None
        if name in ("hsl", "hsla"):
            out = list(colorsys.hls_to_rgb(h, b, a))
        elif a + b >= 1:
            out = [a / (a + b)] * 3
        else:
            out = [c * (1 - a - b) + a for c in colorsys.hls_to_rgb(h, 0.5, 1.0)]
    if None in out:
        return None
    return tuple(int(round(min(1.0, max(0.0, c)) * 255)) for c in out)


def css_string(text, i, end, q):
    """(the raw words, where the string ends) of a CSS string whose quote is just before i; a line break ends a
    broken one, as CSS reads it."""
    start, pat = i, CSS_STR[q]
    while True:
        j = pat.match(text, i, end).end()
        if j >= end:
            return text[start:end], end
        if text[j] == q:
            return text[start:j], j + 1
        if text[j] == "\\":
            i = min(end, j + (3 if text.startswith("\r\n", j + 1) else 2))
            continue
        return text[start:j], j


def js_string(text, i, end, q):
    start, pat = i, JS_STR[q]
    while True:
        j = pat.match(text, i, end).end()
        if j >= end:
            return text[start:end], end
        if text[j] == q:
            return text[start:j], j + 1
        if text[j] == "\\":
            i = min(end, j + (3 if text.startswith("\r\n", j + 1) else 2))
            continue
        return text[start:j], j


def js_template(text, i, end):
    """(the words up to the end or the first ${, where they stop, whether a ${ was opened)."""
    start = i
    while True:
        j = JS_TPL.match(text, i, end).end()
        if j >= end:
            return text[start:end], end, False
        if text[j] == "`":
            return text[start:j], j + 1, False
        if text[j] == "\\":
            i = min(end, j + 2)
            continue
        if text.startswith("${", j):
            return text[start:j], j + 2, True
        i = j + 1


def js_regex(text, i, end):
    """Where a regular expression literal whose slash is just before i ends (at the latest, its line's end)."""
    in_class = False
    while i < end:
        i = JS_RE_CHUNK.match(text, i, end).end()
        if i >= end:
            return end
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c in "\n\r":
            return i
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        elif not in_class:
            return JS_FLAGS.match(text, i + 1, end).end()
        i += 1
    return min(i, end)


def regex_may_start(prev):
    kind, tok = prev
    if kind is None:
        return True
    if kind in ("num", "str", "re"):
        return False
    if kind == "id":
        return tok in JS_BEFORE_EXPR
    if kind == "p":
        return tok in ("(", "[", "{", "}", ";", ",")
    return True


class Lines:
    """Line numbers of a text's offsets."""

    def __init__(self, text):
        self.nl, i = [], text.find("\n")
        while i >= 0:
            self.nl.append(i)
            i = text.find("\n", i + 1)

    def at(self, offset):
        return bisect.bisect_left(self.nl, offset) + 1


class Found:
    """A site's entries: the first PER_CODE of each rule listed, the rest counted in one more line."""

    def __init__(self, piece):
        self.piece, self.seen, self.counts, self.over = piece, set(), {}, {}

    def add(self, code, detail, hard=True, where=None):
        key = (code, where, detail)
        if key in self.seen:
            return
        if len(self.seen) < 20000:
            self.seen.add(key)
        self.counts[code] = self.counts.get(code, 0) + 1
        if self.counts[code] > PER_CODE:
            self.over[code] = self.over.get(code, 0) + 1
            return
        self.piece.add(code, where or self.piece.where, detail, hard)

    def finish(self):
        for code in sorted(self.over):
            self.piece.add(code, self.piece.where, "and %d more like this in this site" % self.over[code],
                           code != "font_collection")


def walk_site(piece, found):
    """{path in the site: (path on disk, size)} of the site's plain files, by lstat, never through a link, in a
    fixed order, with the page viewer's caps. What is passed over is a hard could_not_check."""
    files, entries, total = {}, 0, 0
    stack = [(piece.path, "")]
    while stack:
        folder, rel = stack.pop()
        listed = []
        try:
            with os.scandir(folder) as it:
                for e in it:
                    entries += 1
                    if entries > SITE_ENTRIES:
                        break
                    listed.append(e)
        except OSError:
            found.add("could_not_check", "%s could not be listed" % (shown_path(rel) if rel else "the site's folder"))
            continue
        if entries > SITE_ENTRIES:
            found.add("could_not_check", "the site holds more than %d files and folders; the check reads no more, "
                      "and the page viewer takes no more" % SITE_ENTRIES)
            stack = []
        folders = []
        for e in sorted(listed, key=lambda x: x.name):
            name = rel + "/" + e.name if rel else e.name
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            if stat.S_ISDIR(st.st_mode):
                if name.count("/") + 2 > SITE_SEGMENTS:
                    found.add("could_not_check", "%s is too deep: a site's files are at most %d names deep, the "
                              "file's own included" % (shown_path(name), SITE_SEGMENTS))
                else:
                    folders.append((e.path, name))
            elif stat.S_ISREG(st.st_mode):
                files[name] = (e.path, st.st_size)
                total += st.st_size
            else:
                found.add("could_not_check", "%s is a link or a special file; the check reads plain files only "
                          "and follows no link" % shown_path(name))
        stack.extend(reversed(folders))
    if total > SITE_BYTES:
        found.add("could_not_check", "the site's files come to more than %d MB; the page viewer takes no more"
                  % (SITE_BYTES // MB))
    return files


class SiteCheck:
    """The page rules on one site piece (K16): its tokens file, colours, type, sizes, addresses, logo, words."""

    def __init__(self, ctx, piece, found, files):
        self.ctx, self.piece, self.found, self.files = ctx, piece, found, files
        self.kit = ctx.kit
        if self.kit:
            self.kit_rgbs = [c["rgb"] for c in self.kit.palette]
            self.kit_names = {"--brand-" + c["name"] for c in self.kit.palette}
            self.families = {" ".join(f.lower().split()) for f in self.kit.families}
            self.faces = ", ".join(owner_words(f, 40) for f in self.kit.families)
        self.cache = {}
        self.texts, self.word_chars, self.words_cut = [], 0, False
        self.header, self.header_seen, self.refs, self.index_read = 0, False, [], False
        self.header_stack = []      # elements open inside the first page's header: (name, hidden)
        self.header_names, self.header_hidden = {}, 0
        self.steps = 0
        # Sizes are judged once every style sheet is read: a custom property and the root's size may be set later.
        self.custom, self.sizes, self.base, self.font_marks, self.data_depth = {}, [], "", None, 0
        self.kit_css = None
        if self.kit:      # the kit's own token, whatever the site writes (setting it again is refused)
            self.custom["--brand-min-size"] = [[(0, "num", (float(self.kit.min_px), "px"))]]

    def step(self):
        self.steps += 1
        if not self.steps & 4095:
            self.piece.tick()

    @staticmethod
    def at(file, line, how=""):
        return "%s, line %d%s" % (file, line, ", " + how if how else "")

    def colour_ok(self, rgb):
        if rgb not in self.cache:
            ok = any(max(abs(a - b) for a, b in zip(rgb, k)) <= 1 for k in self.kit_rgbs)
            if not ok and self.kit.neutrals:
                _, a, b = lab(rgb)
                ok = math.hypot(a, b) <= GREY_CHROMA
            self.cache[rgb] = ok
        return self.cache[rgb]

    def not_kit(self, rgb):
        return "%s is not one of the brand kit's colours; %s" % (hexa(rgb), KIT_COLOURS)

    # --- the files

    def tokens_file(self):
        try:
            want = kitmod.read_capped(os.path.join(self.kit.brand, "kit.css"), MAX_SMALL_JSON)
        except OSError:
            want = None
        if want is None:
            self.found.add("could_not_check", "the brand kit's kit.css could not be read, so the site's copy of it "
                           "was not compared")
            return
        have = None
        if "kit.css" in self.files:
            try:
                have = kitmod.read_capped(self.files["kit.css"][0], MAX_SMALL_JSON) or b""
            except OSError:
                have = b""
        self.kit_css = hashlib.sha256(want).digest()
        if have is None:
            self.found.add("tokens_file_changed", "there is no kit.css at the site's top; copy brand/kit.css into "
                           "it byte for byte")
        elif hashlib.sha256(have).digest() != hashlib.sha256(want).digest():
            self.found.add("tokens_file_changed", "kit.css at the site's top is not brand/kit.css byte for byte; "
                           "copy it again and never change it")

    def font_collections(self):
        for role in ("heading", "body"):
            face = self.kit.type[role]
            f = face.get("file")
            if isinstance(f, str) and f.lower().endswith((".ttc", ".otc")):
                fallback = face.get("fallback") if face.get("fallback") in FALLBACKS else "the fallback face"
                self.found.add("font_collection", "Web pages cannot use a font collection; pages show %s instead. "
                               "Upload the .ttf or .otf." % fallback, hard=False, where=safe(f))

    def read_all(self):
        budget = SITE_TEXT_BYTES
        for name in sorted(self.files):
            ending = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if ending not in PAGE_ENDINGS:
                continue
            path, size = self.files[name]
            shown = shown_path(name)
            if ending == "svg" and self.owners_picture(name, path, size):
                continue        # the owner's own picture (the kit's logo, a company picture): not the site's markup
            if size > PAGE_TEXT_BYTES:
                self.found.add("could_not_check", "%s is more than %d KB; the check reads a page, style sheet or "
                               "script of at most %d KB" % (shown, PAGE_TEXT_BYTES // KB, PAGE_TEXT_BYTES // KB))
                continue
            if size > budget:
                self.found.add("could_not_check", "%s was not read: the site's pages, style sheets and scripts come "
                               "to more than %d MB, and the check reads no more" % (shown, SITE_TEXT_BYTES // MB))
                continue
            try:
                data = kitmod.read_capped(path, PAGE_TEXT_BYTES)
            except OSError:
                data = None
            if data is None:
                self.found.add("could_not_check", "%s is not a plain file of at most %d KB"
                               % (shown, PAGE_TEXT_BYTES // KB))
                continue
            budget -= len(data)
            text = decode_page(data)
            self.base = name.rsplit("/", 1)[0] if "/" in name else ""
            self.piece.tick()
            if ending == "html":
                self.html(shown, text, index=name == "index.html")
                self.index_read = self.index_read or name == "index.html"
            elif ending == "svg":
                self.html(shown, text, svg=True)
            elif ending == "css":
                lines = Lines(text)
                # the site's kit.css, or the kit's own kit.css byte for byte anywhere: it alone sets --brand-…
                own = name.rsplit("/", 1)[-1] == "kit.css" and hashlib.sha256(data).digest() == self.kit_css
                self.css(shown, text, 0, len(text), lines.at, tokens=name == "kit.css" or own)
            else:
                lines = Lines(text)
                self.js(shown, text, 0, len(text), lines.at)

    # --- HTML

    def attrs(self, text, i, end):
        """[(name, raw value, offset)] of a start tag from i, and where the tag ends (after its >)."""
        out = []
        while i < end:
            i = HTML_GAP.match(text, i, end).end()
            if i >= end:
                break
            if text[i] == ">":
                return out, i + 1
            m = ATTR_NAME.match(text, i, end)
            name, at = m.group().translate(ASCII_LOWER), i
            i = HTML_WS.match(text, m.end(), end).end()
            value = ""
            if i < end and text[i] == "=":
                i = HTML_WS.match(text, i + 1, end).end()
                if i < end and text[i] in "\"'":
                    k = text.find(text[i], i + 1, end)
                    value, i = (text[i + 1:end], end) if k < 0 else (text[i + 1:k], k + 1)
                else:
                    v = ATTR_VALUE.match(text, i, end)
                    value, i = v.group(), v.end()
            out.append((name, value, at))
        return out, end

    def html(self, file, text, index=False, nested=0, line=None, svg=False):
        """One page: its tags' attributes, <style> and <script> blocks, and the words it shows. `nested` is a
        page inside an iframe's srcdoc (at most two deep), all of it on the attribute's `line`. `svg`: an .svg
        file of the site (T58e), drawn at a size the check does not know."""
        line_of = Lines(text).at if line is None else (lambda pos: line)
        top = index and nested == 0
        low = text.translate(ASCII_LOWER)
        n, i, words = len(text), 0, []
        # Once an <svg> or <math> is open, the rest of the page is read as if it might still be inside one (the
        # browser's way back out is not followed): <style> and <script> are read as text and as markup.
        foreign = svg
        # T58e: how much each open <svg> scales what it draws (None: not known), innermost last
        svgs = [None] if svg else []
        while i < n:
            self.step()
            j = text.find("<", i)
            if j < 0:
                words.append(text[i:])
                break
            if j > i:
                words.append(text[i:j])
            if text.startswith("<!--", j):
                k = text.find("-->", j + 4)
                i = n if k < 0 else k + 3
                continue
            c = text[j + 1:j + 2]
            if c in ("/", "!", "?"):
                m = TAG_NAME.match(text, j + 2) if c == "/" else None
                k = text.find(">", j + 2)
                i = n if k < 0 else k + 1
                if m:
                    name = m.group().translate(ASCII_LOWER)
                    if name in BLOCK_TAGS:
                        words.append("\n")
                    if name == "svg" and len(svgs) > (1 if svg else 0):
                        svgs.pop()
                    if top and self.header > 0:
                        self.header_close(name)
                    if top and name == "header" and self.header > 0:
                        self.header -= 1
                        if not self.header:
                            self.header = -1
                continue
            m = TAG_NAME.match(text, j + 1)
            if not m:
                words.append("<")
                i = j + 1
                continue
            name = m.group().translate(ASCII_LOWER)
            attrs, i = self.attrs(text, m.end(), n)
            closed = text[i - 2:i] == "/>"
            if name in FOREIGN_TAGS and not closed:
                foreign = True
            if name == "svg" and not closed and len(svgs) < HEADER_STACK:
                k = self.svg_scale(attrs)
                svgs.append(None if k is None or (svgs and svgs[-1] is None) else k * (svgs[-1] if svgs else 1.0))
            if top and name == "header" and self.header >= 0:
                self.header += 1
                self.header_seen = True
            shown = False
            if top and self.header > 0:   # a hidden element, or one inside a hidden one, does not show the logo
                hidden = hides(name, attrs)
                shown = not hidden and not self.header_hidden
                raw = name in RAW_TAGS and (not foreign or name in ("style", "script"))
                if name not in VOID_TAGS and not raw and not (foreign and closed):
                    self.header_open(name, hidden)
            self.start_tag(file, name, attrs, line_of, nested, words, shown)
            if svgs and name in SVG_TEXT and self.kit is not None:
                self.svg_text(file, name, attrs, line_of, svgs[-1])
            if name == "plaintext":
                words.append(text[i:])
                break
            if name in RAW_TAGS and (not foreign or name in ("style", "script")):
                close = low.find("</" + name, i)
                while close >= 0 and close + 2 + len(name) < n and text[close + 2 + len(name)] not in TAG_END:
                    close = low.find("</" + name, close + 2)
                stop = n if close < 0 else close
                self.raw(file, name, attrs, text, i, stop, line_of, words, shown)
                if foreign:
                    decoded, _ = foreign_text(text, low, i, name)
                    at = line_of(i)
                    self.raw(file, name, attrs, decoded, 0, len(decoded), lambda pos, at=at: at, [], shown)
                k = -1 if close < 0 else text.find(">", close)
                i = n if k < 0 else k + 1
        self.add_words(file, words)

    @staticmethod
    def svg_scale(attrs):
        """How much an <svg> scales what it draws: its width and height (plain numbers or px) against its viewBox;
        1 with no viewBox; None when it has a viewBox and no such width and height."""
        seen = {}
        for a, raw, _ in attrs:
            seen.setdefault(a, unescape_html(raw).strip(" \t\n\f\r"))
        if "viewbox" not in seen:
            return 1.0
        box = [_number(x) for x in seen["viewbox"].replace(",", " ").split()]
        if len(box) != 4 or any(b is None for b in box) or box[2] <= 0 or box[3] <= 0:
            return None
        k = []
        for a, b in (("width", box[2]), ("height", box[3])):
            v = seen.get(a, "")
            if _number(v) is None or v.lstrip("+-0123456789.") not in ("", "px"):
                return None
            k.append(_number(v) / b)
        return min(k)

    def svg_text(self, file, name, attrs, line_of, scale):
        """T58e: text in an SVG drawing is drawn at its size times the drawing's scale: refused when that is under
        the kit's smallest, or when the scale is not known (an .svg file, a viewBox with no width and height) or
        is under 1 and the text's own size is not a plain number."""
        if scale is not None and scale >= 1:
            return
        at = attrs[0][2] if attrs else 0
        size = None
        for a, raw, _ in attrs:
            if a == "font-size":
                v = unescape_html(raw).strip(" \t\n\f\r")
                if _number(v) is not None and v.lstrip("+-0123456789.") in ("", "px"):
                    size = _number(v)
                break
        if scale is not None and size is not None:
            if size * scale >= self.kit.min_px:
                return
            what = "text in an SVG drawing set at %g that the drawing's viewBox draws at %s px; the brand kit's " \
                   "smallest is %d px" % (size, "%g" % round(size * scale, 2), self.kit.min_px)
        else:
            what = "text in an SVG drawing (<%s>) that the drawing can draw smaller than it is set; set text in the " \
                   "page, not in a drawing" % name
        self.found.add("text_too_small", "%s: %s" % (self.at(file, line_of(at)), what))

    def owners_picture(self, name, path, size):
        """An .svg of the site that is the kit's logo file or a company picture of the same name, byte for byte:
        the owner's own picture, not read as the site's markup."""
        if self.kit is None or size > MAX_PICTURE_BYTES:
            return False
        try:
            data = kitmod.read_capped(path, MAX_PICTURE_BYTES)
        except OSError:
            data = None
        if not data:
            return False
        mark = hashlib.sha256(data).digest()
        for f in self.kit.logo_files:
            try:
                own = kitmod.read_capped(os.path.join(self.kit.brand, f["file"]), MAX_PICTURE_BYTES)
            except OSError:
                own = None
            if own and hashlib.sha256(own).digest() == mark:
                return True
        base = name.rsplit("/", 1)[-1]
        if FILE_NAME.match(base):
            try:
                own = kitmod.find_picture_bytes(self.ctx.state, base, MAX_PICTURE_BYTES)
            except (OSError, ValueError, kitmod.KitProblem):
                own = None
            if own and hashlib.sha256(own).digest() == mark:
                return True
        return False

    def header_open(self, name, hidden):
        if len(self.header_stack) >= HEADER_STACK:
            return
        self.header_stack.append((name, hidden))
        self.header_names[name] = self.header_names.get(name, 0) + 1
        self.header_hidden += hidden

    def header_close(self, name):
        """An end tag inside the header closes the newest open element of its name and all opened after it (an end
        tag of no open element is passed over, as the browser passes it over)."""
        if not self.header_names.get(name):
            return
        while self.header_stack:
            got, hidden = self.header_stack.pop()
            self.header_names[got] -= 1
            self.header_hidden -= hidden
            if got == name:
                return

    def start_tag(self, file, name, attrs, line_of, nested, words, in_header):
        rules = self.kit is not None
        for a, raw, at in attrs:
            v = unescape_html(raw)
            line = line_of(at)
            const = (lambda pos, line=line: line)
            if a == "style":
                self.css(file, v, 0, len(v), const, "in a style attribute", attr=True, header=in_header,
                         root=name == "html")
            elif a in URL_ATTRS:
                if a in ("href", "xlink:href") and name in LINK_TAGS:
                    pass
                else:
                    self.address(file, line, a, v)
                if a in ("src", "data") and name in DATA_TAGS and is_data(v):
                    self.found.add("outside_address", "%s: a data: address in %s %s attribute of <%s>: a page or "
                                   "script that is not a file of the site; %s" % (
                                       self.at(file, line), "an" if a[0] in "aeiou" else "a", a, name, OWN_FILES))
                    if name == "script" and self.data_depth < 2:
                        self.data_depth += 1
                        u = data_text(v)
                        self.js(file, u, 0, len(u), const, "in a script given as a data: address")
                        self.data_depth -= 1
                if a in ("href", "src", "action", "formaction"):
                    u = v.translate(DROP_TAB_NL).lstrip(CONTROL)
                    if u[:11].lower() == "javascript:":
                        u = PERCENT.sub(lambda m: chr(int(m.group(1), 16)), u[11:])
                        self.js(file, u, 0, len(u), const, "in a javascript: address")
                if in_header and name == "img" and a == "src" and len(self.refs) < MAX_REFS:
                    self.refs.append(v)
            elif a.startswith("on") and len(a) > 2:
                self.js(file, v, 0, len(v), const, "in an event attribute")
            elif a in WORD_ATTRS:
                words.append("\n%s\n" % v)
            elif a == "srcdoc" and nested < 2:
                self.html(file, v, nested=nested + 1, line=line)
            elif a == "media" and rules and MOTION in v.translate(ASCII_LOWER):
                self.found.add("hidden_content", "%s: %s" % (self.at(file, line), self.motion_words(
                    "<%s> given" % name if name in ("link", "style", "source") else "an element given")))
            if not rules:
                continue
            if a in SVG_COLOUR_ATTRS or a == "filter" or (a == "color" and name not in LEGACY_COLOUR_TAGS):
                self.css(file, v, 0, len(v), const, "in a %s attribute" % a, attr=True, decl=a)
            elif a == "bgcolor" or (a == "color" and name in LEGACY_COLOUR_TAGS) \
                    or (name == "body" and a in BODY_COLOUR_ATTRS):
                rgb = legacy_colour(v)
                if rgb is not None and not self.colour_ok(rgb):
                    self.found.add("colour_not_token", "%s: %s" % (self.at(file, line, "in a %s attribute" % a),
                                                                  self.not_kit(rgb)))
        if name in ("meta", "link") or name in SMIL_TAGS:
            self.carriers(file, name, attrs, line_of, rules)
        if name in BLOCK_TAGS:
            words.append("\n")

    def carriers(self, file, name, attrs, line_of, rules):
        """What a <meta>, <link> or SVG animation carries besides its plain attributes: a meta refresh's address,
        a style sheet given as a data: address, the values an SVG <set> or <animate> gives another attribute."""
        first = {}
        for a, raw, at in attrs:
            if a not in first:
                first[a] = (unescape_html(raw), line_of(at))
        if name == "meta":
            if first.get("http-equiv", ("",))[0].strip(" \t\n\f\r").lower() == "refresh" and "content" in first:
                v, line = first["content"]
                if is_outside(refresh_url(v)):
                    self.found.add("outside_address", "%s: a meta refresh that sends the visitor to an address outside "
                                   "the site; %s" % (self.at(file, line), OWN_FILES))
        elif name == "link":
            href, line = first.get("href", ("", 0))
            if "stylesheet" in first.get("rel", ("",))[0].lower().split() and is_data(href):
                self.found.add("outside_address", "%s: a style sheet given as a data: address, not a file of the site; "
                               "%s" % (self.at(file, line), OWN_FILES))
                if self.data_depth < 2:
                    self.data_depth += 1
                    u = data_text(href)
                    self.css(file, u, 0, len(u), lambda pos, line=line: line, "in a style sheet given as a data: "
                             "address")
                    self.data_depth -= 1
        else:
            target = first.get("attributename", ("",))[0].strip(" \t\n\f\r").lower()
            for key in SMIL_VALUES:
                if key not in first:
                    continue
                v, line = first[key]
                values = v.split(";")
                if any(is_outside(x.strip(" \t\n\f\r")) for x in values):
                    self.found.add("outside_address", "%s: an address outside the site set by an SVG <%s>; %s"
                                   % (self.at(file, line), name, OWN_FILES))
                if rules and (target in SVG_COLOUR_ATTRS or target in ("color", "filter")):
                    for x in values:
                        self.css(file, x, 0, len(x), lambda pos, line=line: line, "in an SVG <%s>" % name, attr=True,
                                 decl=target)

    def raw(self, file, name, attrs, text, start, stop, line_of, words, in_header):
        if name == "style":
            self.css(file, text, start, stop, line_of, "in a <style> block", header=in_header)
        elif name == "script":
            kind = ""
            for a, raw, at in attrs:
                if a == "type":
                    kind = unescape_html(raw).strip(" \t\n\f\r").lower()
                    break
            if kind in JS_TYPES:
                self.js(file, text, start, stop, line_of, "in a <script> block")
            elif kind in JS_LIST_TYPES:
                self.js(file, text, start, stop, line_of, "in a <script> block", every=True)
        elif name in ("title", "textarea"):
            words.append("\n%s\n" % text[start:stop])

    def address(self, file, line, attr, value):
        if attr in ("srcset", "imagesrcset"):
            urls = [c.split(None, 1)[0] for c in value.split(",") if c.strip()]
        elif attr == "ping":
            urls = value.split()
        else:
            urls = [value]
        if any(is_outside(u) for u in urls):
            self.found.add("outside_address", "%s: an address outside the site in %s %s attribute; %s"
                           % (self.at(file, line), "an" if attr[0] in "aeiou" else "a", attr, OWN_FILES))

    def add_words(self, file, chunks):
        text = unescape_html("".join(chunks))
        if not text.strip():
            return
        left = SITE_WORDS - self.word_chars
        if len(text) > left:
            text = text[:max(0, left)]
            if not self.words_cut:
                self.words_cut = True
                self.found.add("could_not_check", "the words of the site's pages come to more than %d KB; the word "
                               "rules read only that much" % (SITE_WORDS // KB))
        if text:
            self.word_chars += len(text)
            self.texts.append((file, text))

    # --- CSS

    def css(self, file, text, start, end, line_of, how="", attr=False, tokens=False, header=False, decl=None,
            root=False):
        """A style sheet, a <style> block (both: rules, at-rules, declarations in blocks), a style attribute
        (`attr`: declarations at its top), or one presentation attribute's value (`decl`: its property's name).
        `tokens` is the site's kit.css: only its addresses are read. `header`: inside the first page's header,
        where the url()s are kept for the logo. `root`: the style attribute of <html>, whose size is the root's."""
        rules = self.kit is not None and not tokens
        depth, mode, fresh, cand, at_rule = 0, (1 if decl else 0), True, None, None
        prop, prop_at = decl, start
        stack, var_open, url_open = [], 0, 0
        pending, font, cap, cut = [], [], None, False
        keep = self.keeps(prop, None)
        # where a rule's selector starts; for each open block, whether it is the root's; an @font-face being read
        sel_from, roots, face = None, [], None
        # T58e: for each open block, whether it is inside a query on less motion (and the prelude being read names
        # one); the depth of the arguments of a scale() being read
        motions, motion_prelude, scaling = [], False, None
        i = start
        while i < end:
            self.step()
            m = CSS_TOKEN.match(text, i, end)
            kind, tok, pos, i = m.lastgroup, m.group(), m.start(), m.end()
            if kind == "ws":
                continue
            if kind == "cm":
                k = text.find("*/", i, end)
                i = end if k < 0 else k + 2
                continue
            if kind == "q":
                tok, i = css_string(text, i, end, tok)
                kind = "str"
            elif kind == "id" and i < end and text[i] == "(":
                kind, tok, i = "fn", css_unescape(tok).lower(), i + 1
                if tok == "url":
                    k = CSS_WS.match(text, i, end).end()
                    if k < end and text[k] not in "\"'":
                        close = text.find(")", k, end)
                        kind, tok = "url", text[k:end if close < 0 else close]
                        i = end if close < 0 else close + 1
            elif kind == "num":
                u = CSS_UNIT.match(text, i, end)
                unit = ""
                if u:
                    unit, i = css_unescape(u.group()).lower(), u.end()
                tok = (float(tok) if len(tok) <= 40 else 1e40, unit)

            if mode == 0:
                if sel_from is None:
                    sel_from = pos
                if kind == "id" and fresh:
                    cand, prop_at, fresh = tok, pos, False
                elif kind == "other" and tok == ":" and cand is not None and (depth or attr):
                    prop, mode, cand = css_unescape(cand).lower(), 1, None
                    keep = self.keeps(prop, face)
                elif kind == "at" and fresh:
                    at_rule, mode, fresh = css_unescape(tok).lower(), 2, False
                elif kind == "other" and tok in "{};":
                    if tok == "{":
                        depth += 1
                        roots.append(self.is_root(text, sel_from, pos, roots))
                        motions.append(bool(motions and motions[-1]))
                    elif tok == "}":
                        depth = max(0, depth - 1)
                        if roots:
                            roots.pop()
                        if motions:
                            motions.pop()
                        face = self.face_end(file, line_of, how, face, depth)
                    fresh, cand, sel_from = True, None, None
                else:
                    fresh, cand = False, None
                continue

            if mode == 2:       # an at-rule's prelude: its addresses, and the custom property @property names
                if kind == "fn":
                    stack.append(tok)
                    url_open += tok in URL_FUNCS
                elif kind == "other" and tok == "(":
                    stack.append("")
                elif kind == "other" and tok == ")":
                    if stack:
                        url_open -= stack.pop() in URL_FUNCS
                elif kind == "url" or (kind == "str" and (url_open or at_rule == "@import")):
                    url = css_unescape(tok)
                    if is_outside(url):
                        self.found.add("outside_address", "%s: an address outside the site in %s; %s" % (
                            self.at(file, line_of(pos), how), "an @import" if at_rule == "@import" else "an at-rule",
                            OWN_FILES))
                    elif at_rule == "@import" and is_data(url):
                        self.data_sheet(file, line_of(pos), how, url)
                elif kind == "id" and at_rule == "@property" and rules and not stack:
                    self.brand_token(css_unescape(tok), self.at(file, line_of(pos), how), "@property")
                elif kind == "id" and css_unescape(tok).lower() == MOTION:
                    motion_prelude = True
                elif kind == "other" and tok in "{};":
                    if tok == "{":
                        depth += 1
                        roots.append(bool(roots and roots[-1]))
                        motions.append(bool(motions and motions[-1]) or motion_prelude)
                        if at_rule == "@font-face" and rules and face is None:
                            face = {"depth": depth, "pos": pos, "family": None, "src": None}
                    elif tok == "}":
                        depth = max(0, depth - 1)
                        if roots:
                            roots.pop()
                        if motions:
                            motions.pop()
                        face = self.face_end(file, line_of, how, face, depth)
                    elif motion_prelude and rules:      # an @import only for visitors by whether they ask for less motion
                        self.found.add("hidden_content", "%s: %s" % (self.at(file, line_of(pos), how), self.motion_words(
                            "a style sheet imported")))
                    mode, fresh, stack, url_open, sel_from, motion_prelude = 0, True, [], 0, None, False
                continue

            # mode 1: a declaration's value
            if kind == "other" and (tok in "{}" or (tok == ";" and not stack)):
                if tok == "{":      # its name and colon began a nested rule's selector, not a declaration
                    depth += 1
                    roots.append(self.is_root(text, prop_at, pos, roots))
                    motions.append(bool(motions and motions[-1]))
                else:
                    if cap is not None:
                        self.capture(cap, pending)
                    if rules and prop in SHOW_PROPS and motions and motions[-1]:
                        pending.append(("hidden_content", prop_at, self.motion_words("%s set" % prop)))
                    self.commit(file, line_of, how, prop, prop_at, pending, font, rules, cut,
                                (attr and root) or bool(roots and roots[-1]), face)
                    if tok == "}":
                        depth = max(0, depth - 1)
                        if roots:
                            roots.pop()
                        if motions:
                            motions.pop()
                        face = self.face_end(file, line_of, how, face, depth)
                mode, fresh, cand, stack, var_open, url_open, pending, font, cap = 0, True, None, [], 0, 0, [], [], None
                cut, keep, sel_from, scaling = False, False, None, None
                continue
            d = len(stack)
            if kind == "fn" or (kind == "other" and tok == "("):
                name = tok if kind == "fn" else ""
                if keep:
                    if len(font) < FONT_TOKENS:
                        font.append((d, "fn", name))
                    else:
                        cut = True
                if rules and d == 0 and prop in FILTER_PROPS and name not in FILTER_SAFE:
                    pending.append(("colour_not_token", pos, FILTERED))
                elif rules and d == 0 and prop in BLEND_PROPS:
                    pending.append(("colour_not_token", pos, BLENDED))
                if rules:
                    self.shrink_fn(prop, name, d, scaling, pos, pending)
                    if name in SCALE_FUNCS and scaling is None and (prop in TRANSFORM_PROPS or prop[:2] == "--"):
                        scaling = d + 1
                if cap is not None:
                    if len(cap[2]) < CAPTURE_TOKENS:
                        cap[2].append((d - cap[1], "fn", name))
                    else:
                        cap[2].append(("over", None, None))
                elif rules and not var_open and name in COLOUR_FUNCS:
                    cap = [name, d + 1, [], pos]
                elif rules and not var_open and name in UNREAD_FUNCS:
                    pending.append(("colour_not_token", pos, "a colour written with %s(), which the check does not "
                                    "read; %s" % (name, KIT_COLOURS)))
                stack.append(name)
                var_open += name == "var"
                url_open += name in URL_FUNCS
                continue
            if kind == "other" and tok == ")":
                if stack:
                    name = stack.pop()
                    var_open -= name == "var"
                    url_open -= name in URL_FUNCS
                    if cap is not None and len(stack) < cap[1]:
                        self.capture(cap, pending)
                        cap = None
                    if scaling is not None and len(stack) < scaling:
                        scaling = None
                continue
            if rules and kind == "num" and ((scaling is not None and d == scaling)
                                            or (d == 0 and prop in ("zoom", "scale"))):
                v = tok[0] / 100 if tok[1] == "%" else tok[0]
                if tok[1] in ("", "%") and abs(v) < 1:
                    pending.append((SHRINK[0], pos, SHRINK[1] % ("a zoom under 1" if prop == "zoom" else "a scale under 1")))
            elif rules and kind == "id" and d == 0 and prop == "font-size-adjust" \
                    and css_unescape(tok).lower() not in NO_EFFECT:
                pending.append((SHRINK[0], pos, SHRINK[1] % "font-size-adjust"))
            if rules and kind == "num" and d == 0 and prop == "font-size-adjust":
                pending.append((SHRINK[0], pos, SHRINK[1] % "font-size-adjust"))
            if keep:
                if len(font) < FONT_TOKENS:
                    font.append((d, kind, tok))
                else:
                    cut = True
            if rules and d == 0 and (prop in FILTER_PROPS or prop in BLEND_PROPS) and (
                    kind == "url" or kind == "id" and css_unescape(tok).lower() not in NO_EFFECT):
                pending.append(("colour_not_token", pos, FILTERED if prop in FILTER_PROPS else BLENDED))
            if kind == "url" or (kind == "str" and url_open):
                url = css_unescape(tok)
                if is_outside(url):
                    pending.append(("outside_address", pos, "an address outside the site in a url(); " + OWN_FILES))
                elif header and len(self.refs) < MAX_REFS:
                    self.refs.append(url)
                continue
            if rules and kind == "id" and stack and stack[-1] == "color-mix" \
                    and css_unescape(tok).lower() in LONG_HUES:
                pending.append(("colour_not_token", pos, "a colour mixed with color-mix() the long way round the "
                                "hue wheel, which is none of the kit's colours; %s" % KIT_COLOURS))
            elif rules and kind == "id" and stack and stack[-1].endswith("gradient") \
                    and css_unescape(tok).lower() in LONG_HUES:
                pending.append(("colour_not_token", pos, "a gradient drawn the long way round the hue wheel, through "
                                "colours that are none of the kit's; %s" % KIT_COLOURS))
            if cap is not None:
                if len(cap[2]) < CAPTURE_TOKENS:
                    cap[2].append((d - cap[1], kind, tok))
                else:
                    cap[2].append(("over", None, None))
                continue
            if not rules or var_open:
                continue            # what is inside var(…) is not a colour
            if kind == "hash":
                rgb = hex_rgb(css_unescape(tok)[1:])
                if rgb is not None and not self.colour_ok(rgb):
                    pending.append(("colour_not_token", pos, self.not_kit(rgb)))
            elif kind == "id" and prop not in NAME_PROPS:
                rgb = NAMED_COLOURS.get(css_unescape(tok).lower())
                if rgb is not None and not self.colour_ok(rgb):
                    pending.append(("colour_not_token", pos, self.not_kit(rgb)))
        if mode == 1:
            if cap is not None:
                self.capture(cap, pending)
            self.commit(file, line_of, how, prop, prop_at, pending, font, rules, cut,
                        (attr and root) or bool(roots and roots[-1]), face)
        if face is not None:
            self.face_end(file, line_of, how, face, -1)

    @staticmethod
    def keeps(prop, face):
        """Whether a declaration's tokens are kept: type, a custom property, an @font-face's src."""
        return prop is not None and (prop in FONT_PROPS or prop[:2] == "--" or (face is not None and prop == "src"))

    @staticmethod
    def is_root(text, start, stop, roots):
        """Whether a rule's selector (text[start:stop]) is the root's: html or :root, or & inside such a rule."""
        sel = css_unescape(text[start if start is not None else stop:stop]).translate(ASCII_LOWER)
        return ROOT_SELECTOR.search(sel) is not None or ("&" in sel and bool(roots and roots[-1]))

    @staticmethod
    def motion_words(what):
        return ("%s only for visitors by whether they ask for less motion: the owner's pictures are taken with less "
                "motion asked, so most visitors would be shown what the owner never saw; show the same parts to "
                "both, and change only movement for less motion" % what)

    @staticmethod
    def shrink_fn(prop, name, d, scaling, pos, pending):
        """T58e: a function in a value that can draw text smaller than it is set: a matrix, a function inside a
        scale() (its factor not worked out), a function as a zoom or scale, attr() outside `content`, paint()."""
        moves = prop in TRANSFORM_PROPS or prop[:2] == "--"
        if name in MATRIX_FUNCS and moves:
            pending.append((SHRINK[0], pos, SHRINK[1] % "a transform matrix"))
        elif scaling is not None and d >= scaling:
            pending.append((SHRINK[0], pos, SHRINK[1] % "a scale() the check cannot work out"))
        elif d == 0 and prop in ("zoom", "scale", "font-size-adjust"):
            pending.append((SHRINK[0], pos, SHRINK[1] % ("a %s the check cannot work out" % prop)))
        if name == "attr" and prop not in ("content",) + FONT_PROPS:
            pending.append(("colour_not_token", pos, "an attr(), which takes a value from the page's markup that the "
                            "check does not compare with the kit; %s" % KIT_COLOURS))
        if name == "paint":
            pending.append(("colour_not_token", pos, WORKLET % KIT_COLOURS))

    def capture(self, cap, pending):
        name, _, toks, pos = cap
        rgb = colour_function(name, toks, self.kit_names)
        if rgb is None:
            pending.append(("colour_not_token", pos, "a colour written with %s() that the check cannot read; %s"
                            % (name, KIT_COLOURS)))
        elif rgb is not True and not self.colour_ok(rgb):
            pending.append(("colour_not_token", pos, self.not_kit(rgb)))

    def commit(self, file, line_of, how, prop, prop_at, pending, font, rules, cut=False, root=False, face=None):
        for code, pos, what in pending:
            self.found.add(code, "%s: %s" % (self.at(file, line_of(pos), how), what))
        if self.kit is None or prop is None:
            return
        where = self.at(file, line_of(prop_at), how)
        if prop[:2] == "--":
            if rules:
                self.brand_token(prop, where, "")
            if not prop.startswith("--brand-"):
                self.define(prop, None if cut else font)
        if not rules:
            return
        if prop in FONT_PROPS:
            self.font_rules(prop, font, where, root, cut and prop == "font-size")
        if face is not None:
            if prop == "font-family":
                face["family"] = self.face_name(font)
            elif prop == "src":
                face["src"] = (list(font), cut, where)

    def brand_token(self, name, where, how):
        """A --brand-… custom property set anywhere but the kit's own kit.css: refused, as the rule it would turn."""
        if not name.lower().startswith("--brand-"):
            return
        n = name.lower()
        code = "font_not_kit" if n in BRAND_FACES else "text_too_small" if n == "--brand-min-size" \
            else "colour_not_token" if n in self.kit_names else "tokens_file_changed"
        self.found.add(code, "%s: %s sets a brand token (--brand-…), which only the brand kit's kit.css may set; "
                       "use the kit's tokens as they are" % (where, "an @property" if how else "the site's own style"))

    def define(self, name, toks):
        """One value of a custom property, kept for the sizes that use it (None: one the check could not read)."""
        if name not in self.custom and len(self.custom) >= CUSTOM_NAMES:
            return
        defs = self.custom.setdefault(name, [])
        if len(defs) < CUSTOM_DEFS:
            defs.append(None if toks is None else list(toks))
        elif defs[-1] is not None:
            defs.append(None)       # more values than are kept: a size through it is not worked out

    def data_sheet(self, file, line, how, url):
        self.found.add("outside_address", "%s: a style sheet given as a data: address, not a file of the site; %s"
                       % (self.at(file, line, how), OWN_FILES))
        if self.data_depth < 2:
            self.data_depth += 1
            u = data_text(url)
            self.css(file, u, 0, len(u), lambda pos: line, "in a style sheet given as a data: address")
            self.data_depth -= 1

    # --- @font-face

    @staticmethod
    def face_name(toks):
        top = [t for t in toks if t[0] == 0]
        if top and top[0][1] == "str":
            name = css_unescape(top[0][2])
        else:
            words = []
            for t in top:
                if t[1] != "id":
                    break
                words.append(css_unescape(t[2]))
            name = " ".join(words)
        return " ".join(name.lower().split())

    def face_end(self, file, line_of, how, face, depth):
        """At the end of an @font-face block (when `depth` is above it no more): a kit face's name given any file
        that is not the kit's own font, byte for byte, or any face but the kit's on this Mac, is font_not_kit."""
        if face is None or depth >= face["depth"]:
            return face
        if face["family"] in self.families and face["src"] is not None:
            toks, cut, where = face["src"]
            ok, k = not cut, 0
            while ok and k < len(toks):
                d, kind, tok = toks[k]
                k += 1
                if d != 0 or (kind == "other" and tok == ","):
                    continue
                if kind == "url":
                    ok = self.kit_font(css_unescape(tok))
                elif kind == "fn" and tok in ("url", "local"):
                    arg = []
                    while k < len(toks) and toks[k][0] > 0:
                        if toks[k][0] == 1:
                            arg.append(toks[k])
                        k += 1
                    if tok == "url":
                        ok = bool(arg) and arg[0][1] == "str" and self.kit_font(css_unescape(arg[0][2]))
                    else:
                        ok = self.face_name([(0,) + t[1:] for t in arg]) in self.families
                elif kind == "fn" and tok in ("format", "tech"):
                    continue
                else:
                    ok = False
            if not ok:
                shown = next((owner_words(f, 40) for f in self.kit.families
                              if " ".join(f.lower().split()) == face["family"]), "the kit's face")
                self.found.add("font_not_kit", "%s: an @font-face gives the brand kit's face %s a file that is not the "
                               "kit's own; copy the kit's font from brand/fonts/ into the site and point at it"
                               % (where, shown))
        return None

    def kit_font(self, ref):
        """Whether an address in a style sheet names a file of the site that is a kit font file, byte for byte."""
        if self.font_marks is None:
            self.font_marks = {}
            for role in ("heading", "body"):
                f = self.kit.type[role].get("file")
                if not isinstance(f, str):
                    continue
                try:
                    data = kitmod.read_capped(os.path.join(self.kit.brand, "fonts", f), MAX_PICTURE_BYTES)
                except OSError:
                    data = None
                if data:
                    self.font_marks.setdefault(len(data), set()).add(hashlib.sha256(data).digest())
        r = ref.translate(DROP_TAB_NL).strip(CONTROL)
        name = site_ref(r if r[:1] in ("/", "\\") or not self.base else self.base + "/" + r)
        if name not in self.files or self.files[name][1] not in self.font_marks:
            return False
        try:
            data = kitmod.read_capped(self.files[name][0], MAX_PICTURE_BYTES)
        except OSError:
            return False
        return bool(data) and hashlib.sha256(data).digest() in self.font_marks.get(len(data), ())

    # --- type

    def font_rules(self, prop, toks, where, root=False, cut=False):
        for k, t in enumerate(toks):           # !important is not part of the value
            if t[0] == 0 and t[1:] == ("other", "!"):
                toks = toks[:k]
                break
        top = [k for k, t in enumerate(toks) if t[0] == 0]
        if prop == "font-size":
            self.size_rule(toks, top[:1], where, root, cut)
            return
        if prop == "font-family":
            if not self.family_ok(toks, top, 0):
                self.found.add("font_not_kit", "%s: a font-family that starts with neither the brand kit's faces "
                               "(%s) nor var(--brand-heading) or var(--brand-body)" % (where, self.faces))
            return
        if len(top) == 1 and toks[top[0]][1] == "id" and css_unescape(toks[top[0]][2]).lower() in WIDE:
            return
        k = 0
        while k < len(top) and self.font_lead(toks[top[k]], toks[top[k - 1]] if k else None):
            k += 1
        if k < len(top) and self.font_size(toks[top[k]]):
            if k == len(top) - 1 and toks[top[k]][1:] == ("fn", "var"):
                pass            # `font: var(--brand-body)`: the one var is the face
            else:
                self.size_rule(toks, top[k:k + 1], where, root)
                k += 1
                if k < len(top) and toks[top[k]][1:] == ("other", "/"):
                    k += 2
        if not self.family_ok(toks, top, k):
            self.found.add("font_not_kit", "%s: a font shorthand whose face starts with neither the brand kit's "
                           "faces (%s) nor var(--brand-heading) or var(--brand-body)" % (where, self.faces))

    @staticmethod
    def font_lead(t, before):
        """A word or number of `font` before its size: style, variant, weight, stretch, an oblique's angle."""
        _, kind, tok = t
        if kind == "id":
            return css_unescape(tok).lower() in FONT_LEAD
        if kind == "num":
            return tok[1] == "" or (tok[1] in ANGLES and before is not None and before[1] == "id")
        return False

    @staticmethod
    def font_size(t):
        _, kind, tok = t
        if kind == "num":
            return tok[1] != ""
        if kind == "id":
            return css_unescape(tok).lower() in FONT_SIZES
        return kind == "fn"

    def size_rule(self, toks, top, where, root=False, cut=False):
        """A text size, judged when every style sheet is read (judge_sizes): `root` when it is the root's."""
        if top:
            self.sizes.append((toks, top[0], where, root, cut))

    def judge_sizes(self):
        """text_too_small: a size under the kit's smallest, worked out in px: rem, em and % of the root's size (the
        smallest the site gives html or :root, else 16 px), var() through every value the site gives the custom
        property (and its fallback), calc(), min() (any argument), clamp() (its first), max() (when every argument
        is known). A size the check cannot work out because the site leaves it to something it does not set is
        refused; one in units of the screen is not judged."""
        self.var_memo, self.var_busy = {}, 0
        bases = []
        for toks, i, where, root, cut in self.sizes:
            if root and not cut:
                try:
                    r = self.size_of(toks, i, ROOT_PX)
                except Unresolved:
                    r = None
                if r is not None and r[2]:
                    bases.append(max(0.0, r[0]))
        base = min(bases) if bases else ROOT_PX
        for toks, i, where, root, cut in self.sizes:
            self.step()
            try:
                if cut:
                    raise Unresolved()
                r = self.size_of(toks, i, ROOT_PX if root else base)
            except Unresolved:
                self.found.add("text_too_small", "%s: a text size the check cannot work out (through a var() that "
                               "no style of the site sets, an attr() or a value too long to read); set sizes in px "
                               "or rem, or with var(--brand-min-size)" % where)
                continue
            if r is not None and r[2] and r[0] < self.kit.min_px:
                self.found.add("text_too_small", "%s: text set at %s px; the brand kit's smallest is %d px"
                               % (where, "%g" % round(max(0.0, r[0]), 2), self.kit.min_px))

    @staticmethod
    def args_of(toks, i):
        """The direct arguments of the function at toks[i], split at its commas: [[index, ...], ...]."""
        d, args, j = toks[i][0], [[]], i + 1
        while j < len(toks) and toks[j][0] > d:
            if toks[j][0] == d + 1:
                if toks[j][1:] == ("other", ","):
                    args.append([])
                else:
                    args[-1].append(j)
            j += 1
        return args

    def size_of(self, toks, i, root):
        """(smallest, largest, is a length) of the value at toks[i] in px, or None when it is not worked out;
        raises Unresolved for a value the site leaves to something it never sets."""
        _, kind, tok = toks[i]
        if kind == "num":
            v, u = tok
            if u in ABS_UNITS:
                return (v * ABS_UNITS[u], v * ABS_UNITS[u], True)
            if u in ROOT_UNITS:
                return (v * ROOT_UNITS[u] * root, v * ROOT_UNITS[u] * root, True)
            return (v, v, False) if u == "" else None
        if kind == "id":
            w = css_unescape(tok).lower()
            if w in SIZE_WORDS:
                return (SIZE_WORDS[w], SIZE_WORDS[w], True)
            return (root / 1.2, root / 1.2, True) if w == "smaller" else None
        if kind != "fn":
            return None
        args = self.args_of(toks, i)
        if tok == "var":
            return self.var_size(toks, args, root)
        if tok == "attr":
            raise Unresolved()
        if tok in ("calc", "", "-webkit-calc"):
            return self.size_sum(toks, args[0], root) if len(args) == 1 else None
        if tok in ("min", "max", "clamp"):
            vals = [self.size_sum(toks, a, root) for a in args]
            known = [v for v in vals if v is not None and v[2]]
            if tok == "min" and known:
                return (min(v[0] for v in known), min(v[1] for v in known), True)
            if tok == "max" and known and len(known) == len(vals):
                return (max(v[0] for v in known), max(v[1] for v in known), True)
            if tok == "clamp" and len(vals) == 3 and vals[0] is not None and vals[0][2]:
                return (vals[0][0], float("inf"), True)
        return None

    def size_sum(self, toks, idxs, root):
        """A calc() expression of the values at idxs (+ and - of * and /), in intervals."""
        items = [toks[j][2] if toks[j][1] == "other" and toks[j][2] in "+-*/" else j for j in idxs]
        if not items:
            return None
        total, op, k = None, None, 0
        while True:
            if k >= len(items) or isinstance(items[k], str):
                return None
            prod = self.size_of(toks, items[k], root)
            k += 1
            while k < len(items) and items[k] in ("*", "/"):
                times = items[k] == "*"
                if k + 1 >= len(items) or isinstance(items[k + 1], str):
                    return None
                rhs = self.size_of(toks, items[k + 1], root)
                k += 2
                prod = None if prod is None or rhs is None else interval(prod, rhs, "*" if times else "/")
            if op is None:
                total = prod
            else:
                total = None if total is None or prod is None else interval(total, prod, op)
            if k >= len(items):
                return total
            if items[k] not in ("+", "-"):
                return None
            op, k = items[k], k + 1

    def var_size(self, toks, args, root):
        first = args[0]
        if not first or toks[first[0]][1] != "id":
            return None
        name = css_unescape(toks[first[0]][2]).lower()
        got = self.custom_size(name, root)
        out = [] if got is None else [got]
        if len(args) == 2 and args[1]:
            fall = self.size_sum(toks, args[1], root)
            if fall is not None:
                out.append(fall)
        elif name not in self.custom:
            raise Unresolved()
        if not out:
            return None
        return (min(v[0] for v in out), max(v[1] for v in out), all(v[2] for v in out))

    def custom_size(self, name, root):
        """The sizes a custom property can hold, over every value the site gives it (worked out once)."""
        key = (name, root)
        if key in self.var_memo:
            got = self.var_memo[key]
            if got == "unresolved":
                raise Unresolved()
            return None if got == "busy" else got      # busy: a loop of var()s, which the browser drops
        if name not in self.custom:
            return None
        if self.var_busy >= VAR_DEPTH:
            self.var_memo[key] = "unresolved"
            raise Unresolved()
        self.var_memo[key] = "busy"
        self.var_busy += 1
        out = []
        try:
            for value in self.custom[name]:
                if value is None:
                    raise Unresolved()
                for k, t in enumerate(value):
                    if t[0] == 0 and t[1:] == ("other", "!"):
                        value = value[:k]
                        break
                top = [k for k, t in enumerate(value) if t[0] == 0]
                if len(top) == 1:
                    r = self.size_of(value, top[0], root)
                    if r is not None:
                        out.append(r)
        except Unresolved:
            self.var_memo[key] = "unresolved"
            raise
        finally:
            self.var_busy -= 1
        got = (min(v[0] for v in out), max(v[1] for v in out), all(v[2] for v in out)) if out else None
        self.var_memo[key] = got
        return got

    def family_ok(self, toks, top, k):
        if k >= len(top):
            return False
        i = top[k]
        d, kind, tok = toks[i]
        if kind == "fn":
            return tok == "var" and i + 1 < len(toks) and toks[i + 1][:2] == (d + 1, "id") \
                and css_unescape(toks[i + 1][2]) in BRAND_FACES
        if kind == "str":
            name = css_unescape(tok)
        elif kind == "id":
            words = []
            for j in top[k:]:
                if toks[j][1] != "id":
                    break
                words.append(css_unescape(toks[j][2]))
            if len(words) == 1 and words[0].lower() in WIDE:
                return True
            name = " ".join(words)
        else:
            return False
        return " ".join(name.lower().split()) in self.families

    # --- JavaScript

    def js(self, file, text, start, end, line_of, how="", every=False):
        """A script: the string literals passed to fetch(), import(), new Worker() and the others of
        JS_CALLEES, and the addresses of static imports. `every`: an import map, where every string counts."""
        stack, prev, prev2, i = [], (None, None), (None, None), start
        while i < end:
            self.step()
            m = JS_TOKEN.match(text, i, end)
            kind, tok, pos, i = m.lastgroup, m.group(), m.start(), m.end()
            if kind == "ws":
                continue
            if kind == "lc":
                k = text.find("\n", i, end)
                i = end if k < 0 else k
                continue
            if kind == "bc":
                k = text.find("*/", i, end)
                i = end if k < 0 else k + 2
                continue
            if kind == "q":
                opened = False
                if tok == "`":
                    s, i, opened = js_template(text, i, end)
                else:
                    s, i = js_string(text, i, end, tok)
                self.js_literal(file, line_of, how, pos, s, stack, prev, every)
                if opened:          # after the literal is judged: its ${ is not the call it is passed to
                    stack.append("${")
                prev2, prev = prev, ("str", None)
                continue
            if kind == "other" and tok == "/" and regex_may_start(prev):
                i = js_regex(text, i, end)
                prev2, prev = prev, ("re", None)
                continue
            if kind == "p":
                if tok == "(":
                    callee = prev[1] if prev[0] == "id" else prev2[1] if prev == ("p", "?.") and prev2[0] == "id" \
                        else None
                    stack.append(callee)
                elif tok in "[{":
                    stack.append(None)
                elif tok in ")]}" and stack:
                    if stack.pop() == "${" and tok == "}":
                        _, i, opened = js_template(text, i, end)
                        if opened:
                            stack.append("${")
                        prev2, prev = prev, ("str", None)
                        continue
            if kind == "id" and "\\" in tok:
                tok = js_unescape(tok)
            if kind == "id" and tok in WORKLETS and self.kit is not None:
                self.found.add("colour_not_token", "%s: %s" % (self.at(file, line_of(pos), how), WORKLET % KIT_COLOURS))
            prev2, prev = prev, (kind, tok)

    def js_literal(self, file, line_of, how, pos, s, stack, prev, every):
        if self.kit is not None and js_unescape(s) in WORKLETS:
            self.found.add("colour_not_token", "%s: %s" % (self.at(file, line_of(pos), how), WORKLET % KIT_COLOURS))
        callee = stack[-1] if stack else None
        if every:
            what = "an import map"
        elif callee in JS_CALLEES:
            what = "a string passed to %s()" % callee
        elif prev[0] == "id" and prev[1] in ("import", "from"):
            what = "a module's address"
        else:
            return
        if is_outside(js_unescape(s)):
            self.found.add("outside_address", "%s: an address outside the site in %s; %s"
                           % (self.at(file, line_of(pos), how), what, OWN_FILES))

    # --- the logo, the viewer's report

    def logo(self):
        """no_logo (when the kit asks for its logo on pages): no file of the site that is a kit logo file, byte for
        byte, is shown by an <img src> or a url() inside the first <header> of index.html. A picture whose own
        attributes, or an element's around it, keep it from being seen (hides()) does not count."""
        if "page" not in self.kit.required_on or not self.index_read:
            return
        if not self.header_seen:
            self.found.add("no_logo", "index.html has no <header>; the brand kit asks for its logo in the header of "
                           "the first page")
            return
        names = [f["file"] for f in self.kit.logo_files]
        marks = {}
        for f in names:
            try:
                data = kitmod.read_capped(os.path.join(self.kit.brand, f), MAX_PICTURE_BYTES)
            except OSError:
                data = None
            if data:
                marks.setdefault(len(data), set()).add(hashlib.sha256(data).digest())
        for ref in self.refs:
            name = site_ref(ref)
            if name not in self.files or self.files[name][1] not in marks:
                continue
            try:
                data = kitmod.read_capped(self.files[name][0], MAX_PICTURE_BYTES)
            except OSError:
                continue
            if data and hashlib.sha256(data).digest() in marks.get(len(data), ()):
                return
        self.found.add("no_logo", "index.html: no picture in its first <header> is the brand kit's logo (%s); copy "
                       "it from brand/ into the site and show it there with <img src>"
                       % (", ".join(safe(n) for n in names) or "the kit has no logo file"))

    def viewer_report(self):
        """With --report: the smallest text the page viewer measured on each page, from viewer/<ref>/report.json of
        the goal (where the Builder keeps the viewer's answer). Missing, unreadable or not the shape: ignored. A
        false report can only add failures."""
        goal = os.path.dirname(os.path.dirname(self.piece.path))
        folder = os.path.join(goal, "viewer", self.piece.name)
        if kind_at(os.path.join(goal, "viewer")) != "dir" or kind_at(folder) != "dir":
            return
        try:
            raw = read_json(os.path.join(folder, "report.json"), REPORT_BYTES)
        except (PieceProblem, RecursionError):
            return
        if not isinstance(raw, dict) or not isinstance(raw.get("pages"), list):
            return
        for page in raw["pages"][:REPORT_PAGES]:
            if not isinstance(page, dict) or not isinstance(page.get("fonts"), list):
                continue
            sizes = [f.get("minPx") for f in page["fonts"][:REPORT_FONTS] if isinstance(f, dict)]
            small = [s for s in sizes if kitmod.number(s) and 0 <= s < self.kit.min_px]
            if small:
                shown = shown_path(page["page"]) if isinstance(page.get("page"), str) else UNUSUAL
                self.found.add("text_too_small", "the page viewer measured text of %s px on %s (viewer/%s/report.json);"
                               " the brand kit's smallest is %d px" % ("%g" % min(small), shown,
                                                                      self.piece.where, self.kit.min_px))


def check_site(ctx, piece):
    found = Found(piece)
    if not SITE_FOLDER.match(piece.name):
        found.add("could_not_check", "the site's folder name is not one the home server opens: a site's folder is "
                  "named with lower-case letters, digits and dashes, at most 36, so it is neither pictured nor "
                  "measured; rename it")
    files = walk_site(piece, found)
    piece.tick()
    if "index.html" not in files:
        found.add("could_not_check", "there is no index.html at the site's top")
    sc = SiteCheck(ctx, piece, found, files)
    if ctx.kit:
        sc.tokens_file()
        sc.font_collections()
    sc.read_all()
    if ctx.kit:
        sc.judge_sizes()
        sc.logo()
        if ctx.report:
            sc.viewer_report()
    found.finish()
    piece.texts = []        # three versions of a page share their facts: their words are not compared
    ctx.words.check(piece, sc.texts)


def check_folder_piece(ctx, piece):
    if piece.kind == "site":
        check_site(ctx, piece)
        return
    refuse_twins(piece.path, PIECE_NAMES)
    entries = listing(piece.path)
    at = lambda *parts: os.path.join(piece.path, *parts)   # noqa: E731
    raw, pics, logos = manifest_lists(piece)
    texts = []
    if kind_at(at("copy.md")) == "file":
        texts.append(("copy.md", read_text(os.path.join(piece.path, "copy.md"))))
    if isinstance(raw.get("title"), str):
        texts.append(("manifest.json", raw["title"][:500]))
    # A film's edit records the captions it drew on the picture (video.py film): its own words, written with the
    # video, so editing the film file afterwards cannot hide them. They are read whatever the manifest's maker.
    if isinstance(raw.get("captions"), list):      # all of them: the manifest is at most 64 KB
        found = [c for c in raw["captions"] if isinstance(c, str)]
        if found:
            texts.append(("captions", "\n".join(found)))
    pictures, required, soft_palette = [], set(), set()
    req = ctx.kit.required_on if ctx.kit else []

    if piece.kind == "slides":
        data = read_json(os.path.join(piece.path, "slides.json"), MAX_TEXT_BYTES) if kind_at(at("slides.json")) == "file" else None
        if isinstance(data, dict) and isinstance(data.get("slides"), list):
            for i, s in enumerate(data["slides"][:MAX_SLIDES]):
                if isinstance(s, dict) and isinstance(s.get("text"), str):
                    texts.append(("slide %d" % (i + 1), s["text"]))
        # A slide-NN.png that is a link or a pipe is still a slide: reading it refuses it (could_not_check).
        pictures = [(i + 1, n, at(n)) for i, n in enumerate(SLIDE_NAMES) if kind_at(at(n)) not in (None, "dir")]
        if not pictures:   # never a pass beside a contact.png the check did not measure
            piece.add("could_not_check", piece.where, "there is no slide-01.png to measure; a carousel is checked "
                      "from its slides, never from contact.png")
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
                for key in ("shots", "clips"):     # a reveal's shots; a film's clips (video.py film)
                    for s in data.get(key, []) if isinstance(data.get(key), list) else []:
                        if isinstance(s, dict) and isinstance(s.get("caption"), str):
                            found.append(s["caption"])
                if isinstance(data.get("title"), str):
                    found.append(data["title"])
                if isinstance(data.get("cards"), dict):
                    json_strings(data["cards"], found)
                if found:
                    texts.append((safe(n), "\n".join(found)))
        # The poster and the cards are what the owner is shown: always measured, whatever the manifest says
        # (pictures of the owner's in them are exempt only where a claimed box is verified). The six stills
        # are measured too when the video was drawn by a script.
        # A `cut` is the owner's own footage, which cannot fail a brand rule: its poster and stills are not
        # judged, and a soft note keeps the piece from ever showing as "fits". Claiming `cut` gains nothing.
        footage = raw.get("made_by") == "cut"
        made_by_script = not footage and (raw.get("made_by") == "render"
                                          or any(k == "file" and n.endswith(".py") for n, k in entries))
        # A film's edit (`made_by: "film"`, PLAN-V5 C13) shows Runway's footage, made from the owner's renders:
        # its poster is measured and only warns off the palette. Its title and end cards stay hard.
        if raw.get("made_by") == "film":
            soft_palette.add("poster")
        if kind_at(at("poster.png")) is None:
            piece.add("could_not_check", piece.where, "there is no poster.png to measure")
        else:
            piece.first_picture = at("poster.png")
            if footage:
                piece.add("footage_not_measured", "poster.png", "The poster is a frame of your footage, so its "
                          "colours were not measured.", False)
            else:
                pictures.append(("poster", "poster.png", piece.first_picture))
        if made_by_script and kind_at(at("review")) == "dir":
            refuse_twins(at("review"), STILL_NAMES)
            for n in STILL_NAMES:
                if kind_at(at("review", n)) not in (None, "dir"):
                    pictures.append((n[:-4], n, at("review", n)))
        for card in CARDS:
            if kind_at(at(card + ".png")) not in (None, "dir"):
                pictures.append((card, card + ".png", at(card + ".png")))
                if card in req:
                    required.add(card)
    elif piece.kind == "film":
        if kind_at(at("shotlist.json")) == "file":
            found = []
            json_strings(read_json(os.path.join(piece.path, "shotlist.json"), MAX_TEXT_BYTES), found)
            texts.append(("shotlist.json", "\n".join(found)))
        if kind_at(at("board")) == "dir":
            # Every storyboard still the home server can show, shot-01.png to shot-12.png, each only in exactly
            # that name (its exactlyThere): a board in another letter case is never shown, so never measured.
            listed = refuse_twins(at("board"), SHOT_NAMES)
            for n in SHOT_NAMES:
                if n in listed and kind_at(at("board", n)) not in (None, "dir"):
                    pictures.append((n[:-4], n, at("board", n)))
        if not pictures or pictures[0][1] != SHOT_NAMES[0]:
            piece.add("could_not_check", piece.where, "there is no board/shot-01.png to measure")
        else:
            piece.first_picture = pictures[0][2]

    piece.texts = texts
    ctx.words.check(piece, texts)
    piece.tick()
    if piece.kind in ("slides", "video"):
        check_scripts(ctx, piece, entries)
    if piece.kind in ("slides", "video", "film"):
        check_pictures(ctx, piece, pictures, pics, logos, required, soft_palette, room=piece.kind == "film")


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
        if time.monotonic() > ctx.deadline:
            hard("could_not_check", "the check ran out of time (%d seconds in all) before it compared the variants"
                 % TOTAL_SECONDS)
            ids = []
        pics = {}
        for i in ids:
            if time.monotonic() > ctx.deadline:
                hard("could_not_check", "the check ran out of time (%d seconds in all) while it compared the "
                     "variants" % TOTAL_SECONDS)
                ids = []
                break
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
    """The goal's folder, or None when it is missing or not a plain folder (the maker's doing: no_pieces).
    A bad identifier or a folder outside the task-folder tree is a problem with the command: exit 2."""
    homes = [os.path.join(state, "tasks", "company-work"), os.path.join(state, "tasks", "_proof")]
    if not isinstance(goal_id, str) or not (GOAL_ID.match(goal_id) or NAME.match(goal_id)):
        raise Problem("give the goal's identifier, such as STH-12")
    here = os.path.realpath(cwd)
    for home in homes:
        home = os.path.realpath(home)
        if here.lower() != home.lower():
            continue
        if os.path.basename(home) == "company-work" and not GOAL_ID.match(goal_id):
            break
        goal = os.path.join(here, goal_id)
        try:
            st = os.lstat(goal)
        except OSError:
            return None
        return goal if stat.S_ISDIR(st.st_mode) else None
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
    return pieces       # in a fixed order: by folder, then by name


def check(state, cwd, goal_id, deadline, report=False):
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
    ctx.report = report
    pieces = find_pieces(goal) if goal else []
    if not pieces:
        none = Piece("goal", goal_id, os.path.join(cwd, goal_id), True)
        none.add("no_pieces", safe(goal_id), "the goal holds no piece to check: nothing in content, drafts, "
                 "slides, video, film or site")
        variants = check_variants(ctx, goal, {}) if goal else {"result": "pass", "hard": [], "present": False}
        return {"version": 1, "kit": status, "pieces": [none.shape()], "variants": variants}
    kinds = variant_kinds(goal)
    by_path = {}
    rest, pieces = pieces[MAX_PIECES:], pieces[:MAX_PIECES]     # the first 40, in the fixed order
    for p in pieces:
        if time.monotonic() > deadline:
            p.add("could_not_check", p.where, "the check ran out of time (%d seconds in all) before this piece"
                  % TOTAL_SECONDS)
            continue
        p.variant_kind = kinds.get(p.path)
        p.deadline = deadline
        check_piece(ctx, p)
        by_path[p.path] = p
    if status == "missing":
        pieces[0].add("kit_missing", "brand/kit.json", "there is no brand kit yet, so colours, the logo and type "
                      "were not checked; the word rules were", False)
    variants = check_variants(ctx, goal, by_path)
    shapes = [p.shape() for p in pieces]
    if rest:   # agreed with the home server's parser: at most 40 pieces, then one piece of kind "goal"
        over = Piece("goal", goal_id, goal, True)
        over.add("too_many_pieces", safe(goal_id), "the goal holds %d more pieces than the %d a goal may have; "
                 "they were not checked" % (len(rest), MAX_PIECES))
        shapes.append(over.shape())
    return {"version": 1, "kit": status, "pieces": shapes, "variants": variants}


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
    as_json, report, state, goal_id, args = False, False, None, None, list(argv)
    while args:
        a = args.pop(0)
        if a == "--json":
            as_json = True
        elif a == "--report":      # takes no value: each site's viewer/<ref>/report.json (PLAN-V5 C16)
            report = True
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
        report = check(state, os.path.realpath(cwd or os.getcwd()), goal_id, time.monotonic() + TOTAL_SECONDS,
                       report)
    except Problem as e:
        return 2, "", "brandcheck: could not check: %s.\n" % e
    except OutOfTime:   # the maker's pieces took the time: a hard fail, never "could not check"
        return 1, "", TOO_SLOW
    failed = any(p["result"] == "fail" for p in report["pieces"]) or report["variants"]["result"] == "fail"
    code = 1 if failed else 2 if report["kit"] == "unreadable" else 0
    out = json.dumps(report, ensure_ascii=False) + "\n" if as_json else plain(report)
    return code, out, ""


TOO_SLOW = ("brandcheck: fail: the check took longer than %d seconds, so not every piece was checked; "
            "make the pieces smaller or fewer.\n" % TOTAL_SECONDS)


def out_of_time(signum, frame):
    raise OutOfTime()


def main(argv):
    signal.signal(signal.SIGALRM, out_of_time)
    signal.alarm(TOTAL_SECONDS + 5)
    try:
        code, out, err = run(argv)
    except OutOfTime:
        code, out, err = 1, "", TOO_SLOW
    except Exception as e:   # never a trace: one line
        code, out, err = 2, "", "brandcheck: could not check: %s.\n" % type(e).__name__
    finally:
        signal.alarm(0)
    sys.stdout.write(out)
    sys.stderr.write(err)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
