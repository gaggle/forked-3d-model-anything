#!/usr/bin/env python3
"""Mean sRGB colour of a box in a photo vs the matching model render, and the ratio.

usage: region_stats.py <room-id> <cmp dir> <photo#> x0,y0,x1,y1 [...more boxes]   (boxes in 0–1 image fractions)
Reads data/web-assets/<room>/photos/NNNN.jpg and <cmp dir>/ph-<room>-N-model.png.
Photos have per-frame auto exposure: judge colour over several photos.
"""
import sys, numpy as np
from PIL import Image
room, d, n, *boxes = sys.argv[1:]
ph = np.asarray(Image.open(f'data/web-assets/{room}/photos/{int(n):04d}.jpg').convert('RGB')).astype(float)
md = np.asarray(Image.open(f'{d}/ph-{room}-{n}-model.png').convert('RGB')).astype(float)
for b in boxes:
    x0, y0, x1, y1 = map(float, b.split(','))
    crop = lambda a: a[int(y0 * a.shape[0]):int(y1 * a.shape[0]), int(x0 * a.shape[1]):int(x1 * a.shape[1])].reshape(-1, 3).mean(0)
    p, q = crop(ph), crop(md)
    print(f'{n} [{b}] photo {p.round()} model {q.round()} ratio {(p / q).round(2)}')
