# The Books' creature: a little ledger standing on two feet, whose cover lifts to peek at its pages.
# Drawn by us for the company engine. Run: <art python> engine/art/sprite.py books.py
from PIL import Image

title = "Books, idle"
COLOURS = {"o": "#17141f", "b": "#69d98b", "s": "#3fa862", "h": "#b9f0c8", "a": "#f2f3f5"}

BASE = [
    "................",
    "................",
    "...ooooooooooo..",
    "..osohhhhhhhhbo.",
    "..osohbbbbbbbbo.",
    "..osobbbbbbbbbo.",
    "..osobobbbbobbo.",
    "..osobobbbbobbo.",
    "..osobbbbbbbbbo.",
    "..osobbboobbbbo.",
    "..osobbbbbbbbbo.",
    "..osobbbbbbbbso.",
    "..ooaaaaaaaaaao.",
    "...oooooooooooo.",
    ".....oo....oo...",
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


PEEK = {(2, 14): ".", (3, 15): "o", (3, 14): "b", (4, 15): "o", (5, 15): "o", (2, 13): "o",
        (12, 14): "a", (11, 15): "o"}
BLINK = {(6, 6): "b", (6, 11): "b"}
frames = [draw(BASE), draw(put(BASE, BLINK)), draw(BASE), draw(down(BASE))]
durations = 400
tags = [{"name": "idle", "from": 0, "to": len(frames) - 1, "direction": "forward"}]
