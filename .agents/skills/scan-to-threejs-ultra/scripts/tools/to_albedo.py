#!/usr/bin/env python3
"""Neutralise a photo crop: divide out its base colour (median, or a percentile) in linear light
and rescale so that base becomes a known albedo.

usage: to_albedo.py <in> <out> <#base-albedo> [--pct 50] [--rotate deg] [--ref x0,y0,x1,y1] [--base r,g,b]
--ref: take the base colour from that pixel box (e.g. the wall beside an object, with the
wall paint as base albedo) instead of the whole crop.
"""
import sys, numpy as np
from PIL import Image
src, out, hexc = sys.argv[1:4]
pct = float(sys.argv[sys.argv.index('--pct') + 1]) if '--pct' in sys.argv else 50
rot = float(sys.argv[sys.argv.index('--rotate') + 1]) if '--rotate' in sys.argv else 0
s2l = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
l2s = lambda x: np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.clip(x, 0, None), 1 / 2.4) - 0.055)
im = Image.open(src).convert('RGB')
if rot: im = im.rotate(rot, expand=True)
a = s2l(np.asarray(im, np.float32) / 255)
lum = a @ np.array([0.2126, 0.7152, 0.0722])
if '--base' in sys.argv:  # explicit base colour (linear), e.g. borrowed from a better-exposed photo
    base = np.array(list(map(float, sys.argv[sys.argv.index('--base') + 1].split(','))))
elif '--ref' in sys.argv:
    x0, y0, x1, y1 = map(int, sys.argv[sys.argv.index('--ref') + 1].split(','))
    base = np.median(a[y0:y1, x0:x1].reshape(-1, 3), 0)
else:
    base = np.median(a[lum >= np.percentile(lum, pct)], 0) if pct != 50 else np.median(a.reshape(-1, 3), 0)
target = s2l(np.array([int(hexc[i:i + 2], 16) for i in (1, 3, 5)]) / 255)
alb = np.clip(a / np.maximum(base, 1e-4) * target, 0, 1)
Image.fromarray((l2s(alb) * 255).astype('u1')).save(out, quality=92)
print(out, 'base lin', np.round(base, 4))
