# People's creature: a sunflower face on a stem, two leaves for arms, swaying in a light breeze.
# Drawn by us for the company engine. Run: <art python> engine/art/sprite.py people.py
from PIL import Image

title = "People, idle"
COLOURS = {"o": "#17141f", "b": "#f7c35a", "s": "#c99227", "h": "#ffe3a3", "a": "#69d98b"}

BASE = [
    "......o..o......",
    "...o.ohooho.o...",
    "..ohoobbbboohbo.",
    "..obhbbbbbbbbso.",
    "...obbbbbbbbbo..",
    "..obbobbbbobbbo.",
    ".ohbbobbbbobbbso",
    "..obbbbbbbbbbso.",
    "..obbbsoosbbbso.",
    "...obbbbbbbbbo..",
    "..ososbbbbsoso..",
    "...o.ooooooo.o..",
    "....oao.oaoaao..",
    "...oaaoooa.oo...",
    "....oo..oa......",
    "........oo......",
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




def lean(rows, top, dx):
    """The head (rows above `top`) leans dx pixels; the stem stays planted."""
    out = []
    for y, r in enumerate(rows):
        if y < top:
            r = ("." * dx + r[:16 - dx]) if dx > 0 else (r[-dx:] + "." * -dx)
        out.append(r)
    return out


BLINK = {(5, 5): "b", (5, 10): "b"}
frames = [draw(BASE), draw(lean(BASE, 11, 1)), draw(put(BASE, BLINK)), draw(lean(BASE, 11, -1))]
durations = 400
tags = [{"name": "idle", "from": 0, "to": len(frames) - 1, "direction": "forward"}]
