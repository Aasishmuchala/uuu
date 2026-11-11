# The launch carousel: three slides in the brand's colours.
from PIL import Image

title = "Launch carousel"
texts = [
    "A new kitchen before the lamps are lit",
    "Order by 30 November and we fit it before Diwali",
    "Book a visit to the Whitefield studio",
]
slides = [Image.new("RGB", (1080, 1350), c) for c in ("#1f3a34", "#f4efe6", "#e8b04a")]
