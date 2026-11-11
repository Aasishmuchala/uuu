# The opening title: the company's name on its own colour, one second.
from PIL import Image

title = "Opening title"
size = (320, 180)
fps = 30
frames = (Image.new("RGB", size, "#1f3a34") for _ in range(fps))
