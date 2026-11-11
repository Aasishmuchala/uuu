# Support's creature: a round helper wearing a headset, who lifts a hand to say it is listening.
# Drawn by us for the company engine. Run: <art python> engine/art/sprite.py support.py
from PIL import Image

title = "Support, idle"
COLOURS = {"o": "#17141f", "b": "#5fb8ff", "s": "#3a88cc", "h": "#bfe3ff", "a": "#f2f3f5"}

BASE = [
    "................",
    "....oooooooo....",
    "...oaaaaaaaao...",
    "..oaooooooooao..",
    ".oaaohhbbbboaao.",
    ".oaaohbbbbsoaao.",
    ".oaaobobbobooaao",
    ".oaaobobbobooaao",
    "..ooobbbbbbooo..",
    "....obboobbo....",
    "....osssssso....",
    ".....oooooo.....",
    "....obbbbbbo....",
    "...obobbbbobo...",
    "....osssssso....",
    ".....oo..oo.....",
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


HAND_UP = {(13, 3): ".", (13, 4): "o", (12, 3): "o", (11, 3): "b", (11, 2): "o", (10, 3): "o", (11, 4): "o"}
BLINK = {(6, 6): "b", (6, 9): "b"}
frames = [draw(BASE), draw(put(BASE, HAND_UP)), draw(BASE), draw(put(BASE, BLINK))]
durations = 400
tags = [{"name": "idle", "from": 0, "to": len(frames) - 1, "direction": "forward"}]
