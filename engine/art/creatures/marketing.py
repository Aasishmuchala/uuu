# Marketing's creature: a little caller with a cone-shaped crest that sends out a ring of sound.
# Drawn by us for the company engine. Run: <art python> engine/art/sprite.py marketing.py
from PIL import Image

title = "Marketing, idle"
COLOURS = {"o": "#17141f", "b": "#d48cff", "s": "#a35fd0", "h": "#ecc6ff", "a": "#ffffff"}

BASE = [
    "................",
    "......oooo......",
    ".....ohhbo......",
    "....ohbbbo......",
    "...ohbbbbbo.....",
    "..oooooooooo....",
    "..ohhbbbbbbbo...",
    ".ohbbbbbbbbbbo..",
    ".obbbobbbobbbo..",
    ".obbbobbbobbbo..",
    ".obbbbooobbbso..",
    ".osbbbbbbbbbso..",
    "..osbbbbbbbso...",
    "...ooosssooo....",
    "....oo...oo.....",
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


RING_1 = {(3, 12): "a", (4, 13): "a", (5, 13): "a"}
RING_2 = {(1, 13): "a", (2, 14): "a", (3, 15): "a", (4, 15): "a", (3, 12): "a", (4, 13): "a", (5, 13): "a"}
BLINK = {(8, 5): "b", (8, 9): "b"}
frames = [draw(BASE), draw(put(BASE, RING_1)), draw(put(BASE, RING_2)), draw(put(down(BASE), BLINK))]
durations = 400
tags = [{"name": "idle", "from": 0, "to": len(frames) - 1, "direction": "forward"}]
