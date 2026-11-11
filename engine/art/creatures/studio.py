# The Studio's creature: a drop of paint whose tip is still wet with another colour.
# Drawn by us for the company engine. Run: <art python> engine/art/sprite.py studio.py
from PIL import Image

title = "Studio, idle"
COLOURS = {"o": "#17141f", "b": "#3fd6c4", "s": "#23a596", "h": "#a8f2e8", "a": "#ff8a6b"}

BASE = [
    "................",
    ".......oo.......",
    "......oaao......",
    "......oaao......",
    ".....oaaaao.....",
    ".....ohbbbo.....",
    "....ohbbbbbo....",
    "...ohbbbbbbbo...",
    "..ohbbbbbbbbbo..",
    "..obbobbbbobbo..",
    "..obbobbbbobbo..",
    ".obbbbbbbbbbbso.",
    ".osbbbboobbbbso.",
    "..osbbbbbbbbso..",
    "...ossssssssso..",
    ".....oooooo.....",
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


BLINK = {(9, 5): "b", (9, 10): "b"}
WET = {(5, 7): "a"}
frames = [draw(BASE), draw(put(BASE, WET)), draw(put(BASE, BLINK)), draw(down(BASE[:15] + ["." * 16]))]
durations = 400
tags = [{"name": "idle", "from": 0, "to": len(frames) - 1, "direction": "forward"}]
