# Operations' creature: a small square robot with an antenna whose light blinks while it keeps things running.
# Drawn by us for the company engine. Run: <art python> engine/art/sprite.py operations.py
from PIL import Image

title = "Operations, idle"
COLOURS = {"o": "#17141f", "b": "#8b9cff", "s": "#5f6ccc", "h": "#c4ccff", "a": "#f7c35a"}

BASE = [
    ".......oo.......",
    "......oaao......",
    ".......oo.......",
    "........o.......",
    "...oooooooooo...",
    "..ohhhbbbbbbbo..",
    "..ohbbbbbbbbso..",
    "..obbobbbbobso..",
    "..obbobbbbobso..",
    "..obbbbbbbbbso..",
    "...oooooooooo...",
    "..oo.obsbbso.oo.",
    "..oboobbbbsoobo.",
    "...o.osbbbso.o..",
    ".....oo..oo.....",
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


LIGHT_OFF = {(1, 7): "h", (1, 8): "h"}
BLINK = {(7, 5): "b", (7, 10): "b"}
frames = [draw(BASE), draw(put(BASE, LIGHT_OFF)), draw(put(BASE, BLINK)), draw(put(down(BASE), LIGHT_OFF))]
durations = 400
tags = [{"name": "idle", "from": 0, "to": len(frames) - 1, "direction": "forward"}]
