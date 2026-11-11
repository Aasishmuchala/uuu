# The mascot's walk cycle: four frames of 16 x 16, tagged "walk".
from PIL import Image, ImageDraw

title = "Mascot walk cycle"
frames = []
for n in range(4):
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lift = n % 2
    d.rectangle([4, 3 - lift, 11, 10 - lift], fill="#f4a261")
    d.rectangle([5, 8 - lift, 10, 8 - lift], fill="#2a9d8f")
    d.point([(6, 5 - lift), (9, 5 - lift)], fill="#1b1b1f")
    frames.append(img)
durations = 120
tags = [{"name": "walk", "from": 0, "to": 3, "direction": "forward"}]
