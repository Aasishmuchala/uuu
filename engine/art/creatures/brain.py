# The company brain's creature: a two-lobed brain on stubby feet, with a spark that comes and goes.
# Drawn by us for the company engine. Run: <art python> engine/art/sprite.py brain.py
from PIL import Image

title = "Company brain, idle"
COLOURS = {"o": "#17141f", "b": "#e8e6ff", "s": "#b4afe0", "h": "#ffffff", "a": "#8b9cff"}

BASE = [
    "................",
    "....ooo..ooo....",
    "...ohhbooobbo...",
    "..ohbbbbobbsbo..",
    ".ohbbsbbobbbbbo.",
    ".obbbbsbobsbbbo.",
    ".obbbbbbobbbbso.",
    ".obbobbbbbbobbo.",
    ".osbobbbbbbobso.",
    ".obbbbbbbbbbbbo.",
    "..osbbbsbbsbbo..",
    "...osbbbbbbso...",
    "....oooooooo....",
    ".....o....o.....",
    "....oo....oo....",
    "................",
]


def put(rows, cells):
    rows = [list(r) for r in rows]
    for (y, x), c in cells.items():
        rows[y][x] = c
    return ["".join(r) for r in rows]


def down(rows):
    return ["." * 16] + rows[:-1]


def draw(rows):
    assert len(rows) == 16 and all(len(r) == 16 for r in rows)
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c != ".":
                im.putpixel((x, y), tuple(int(COLOURS[c][i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    return im


SPARK = {(0, 14): "a", (1, 15): "a", (1, 13): "a", (2, 14): "a"}
BLINK = {(7, 4): "b", (7, 11): "b"}
frames = [draw(BASE), draw(put(BASE, SPARK)), draw(put(BASE, BLINK)), draw(down(BASE))]
durations = 400
tags = [{"name": "idle", "from": 0, "to": len(frames) - 1, "direction": "forward"}]
