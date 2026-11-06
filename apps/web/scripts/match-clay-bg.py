"""Shift each clay render's background to the exact tile colour, leaving the subject untouched.

Usage (needs Pillow): python3 scripts/match-clay-bg.py <dir with Gemini exports> public/images
Skips slots missing from src. Writes real PNGs named after the slots below; keep TARGET in sync with the tile tokens in globals.css.
"""
import os
import sys
from statistics import median
from PIL import Image, ImageChops

TARGET = {'hero':'d7e6ff','nutrition':'ffe2d1','training':'d7e6ff','recovery':'e7e0fa','body':'fff0c2',
          'coach-strict':'ffe2d1','coach-scientist':'d7e6ff','coach-supportive':'d9eedf',
          'coach-longevity':'e7e0fa','cta':'d9eedf',
          'glp1-hero':'ffe2d1','glp1-hydration':'fff0c2','glp1-strength':'e7e0fa','glp1-log':'d7e6ff',
          'glp1-rhythm':'e7e0fa'}
src, dst = sys.argv[1], sys.argv[2]
for name, hexv in TARGET.items():
    if not os.path.exists(f"{src}/{name}.png"):
        continue  # process whichever exports are in src
    im = Image.open(f"{src}/{name}.png").convert("RGB")
    w, h = im.size
    border = [im.getpixel((x, y)) for x in range(0, w, 16) for y in (2, h - 3)] + \
             [im.getpixel((x, y)) for y in range(0, h, 16) for x in (2, w - 3)]
    bg = tuple(int(median(c[i] for c in border)) for i in range(3))
    tgt = tuple(int(hexv[i:i + 2], 16) for i in (0, 2, 4))
    # Weight: 1 near the background colour (incl. soft shadows), fading to 0 on the subject.
    diff = ImageChops.difference(im, Image.new("RGB", im.size, bg)).split()
    dist = ImageChops.lighter(ImageChops.lighter(diff[0], diff[1]), diff[2])
    lo, hi = 28, 70
    mask = dist.point(lambda d: 255 if d <= lo else 0 if d >= hi else int(255 * (hi - d) / (hi - lo)))
    shifted = Image.merge("RGB", [ch.point(lambda v, o=tgt[i] - bg[i]: max(0, min(255, v + o)))
                                  for i, ch in enumerate(im.split())])
    out = Image.composite(shifted, im, mask)
    out.save(f"{dst}/{name}.png", optimize=True)
    corner = '%02x%02x%02x' % out.getpixel((5, 5))
    print(f"{name:18} bg #{'%02x%02x%02x' % bg} -> #{hexv}  corner now #{corner}")
