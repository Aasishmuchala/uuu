# The WebKit and Chrome pictures of one round side by side as numbers (PLAN-MAC-2 M6): for each WebKit picture
# EVID/r<round>/<shot>-<w>-<theme>-webkit.png and the cook harness's Chrome picture of the same name, the share of
# pixels that differ by more than 24 in any channel (both scaled to the WebKit picture's size), whole and by bands of
# the window (top 10 percent, the rest). Writes EVID/r<round>/pairs.json and prints the 25 most different.
# usage: python3 -I pair-diff.py <webkit dir> <chrome dir>
import json, os, sys
from PIL import Image, ImageChops
wk, ch = sys.argv[1], sys.argv[2]
rows = []
for f in sorted(os.listdir(wk)):
    if not f.endswith("-webkit.png"): continue
    c = os.path.join(ch, f.replace("-webkit.png", ".png"))
    if not os.path.exists(c): rows.append({"name": f, "chrome": None}); continue
    a = Image.open(os.path.join(wk, f)).convert("RGB")
    b = Image.open(c).convert("RGB")
    if b.size != a.size: b = b.resize(a.size)
    d = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 24 else 0)
    w, h = d.size
    share = lambda box: sum(1 for v in d.crop(box).getdata() if v) / max(1, (box[2]-box[0])*(box[3]-box[1]))
    rows.append({"name": f, "size": [w, h], "chromeSize": list(Image.open(c).size), "differ": round(share((0, 0, w, h)), 4),
                 "top": round(share((0, 0, w, h // 10)), 4), "rest": round(share((0, h // 10, w, h)), 4)})
json.dump(rows, open(os.path.join(wk, "pairs.json"), "w"), indent=1)
done = [r for r in rows if r.get("chrome", 1) is not None]
print(f"pairs {len(done)}, no chrome picture {len(rows)-len(done)}")
for r in sorted(done, key=lambda r: -r["differ"])[:25]: print(r["name"], r["differ"], r["top"], r["rest"], r["size"], r["chromeSize"])
