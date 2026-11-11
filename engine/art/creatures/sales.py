# Sales' creature: a round songbird, the one that carries the message, waving a wing.
# Drawn by us for the company engine. Run: <art python> engine/art/sprite.py sales.py
from PIL import Image

title = "Sales, idle"
COLOURS = {"o": "#17141f", "b": "#ff8a6b", "s": "#d0603f", "h": "#ffc2b0", "a": "#f7c35a"}

BASE = [
    "................",
    "........oo......",
    ".......obo......",
    ".....ooooooo....",
    "....ohhbbbbbo...",
    "...ohbbbbbbbbo..",
    "...obobbbbobbo..",
    "..oobobaabobboo.",
    ".osobbbaabbbbso.",
    ".ossbhhhhhhbbso.",
    "..oobhhhhhhbso..",
    "...osbhhhhbbso..",
    "....ossssssso...",
    ".....oaooaoo....",
    "....oaa..oaa....",
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


WING_UP = {(8, 1): ".", (8, 2): ".", (9, 1): ".", (9, 2): "o", (7, 0): "o", (6, 1): "o", (7, 1): "s", (8, 2): "o",
           (6, 0): ".", (5, 1): "."}
BLINK = {(6, 5): "b", (6, 10): "b"}
frames = [draw(BASE), draw(put(BASE, WING_UP)), draw(BASE), draw(put(BASE, BLINK))]
durations = 400
tags = [{"name": "idle", "from": 0, "to": len(frames) - 1, "direction": "forward"}]
