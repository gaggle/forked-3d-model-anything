#!/usr/bin/env python3
"""Rectify a planar face from a posed photo.

usage: rectify.py <session dir> <scan.json> <photo#> <out.png> <W>x<H> x,y,z x,y,z x,y,z x,y,z [--check out.jpg]
Corners in room coordinates, ordered top-left, top-right, bottom-right, bottom-left as the face
should appear in the output. Projects them with the raw photo's pose and intrinsics and
unwarps the raw sensor pixels. --check draws the projected quad on the (upright) photo.
"""
import sys, json, numpy as np
from PIL import Image, ImageDraw

src, scanj, n, out, size, *rest = sys.argv[1:]
check = rest[rest.index('--check') + 1] if '--check' in rest else None
pts = [list(map(float, p.split(','))) for p in rest[:4]]
W, H = map(int, size.split('x'))
M = np.array(json.load(open(scanj))['transform']['worldToRoom']).reshape(4, 4).T
p = json.load(open(f'{src}/photos/photos.json'))[int(n)]
Ti = np.linalg.inv(M @ np.array(p['transform']).reshape(4, 4).T)
fx, fy, cx, cy = p['intrinsics'][0], p['intrinsics'][4], p['intrinsics'][6], p['intrinsics'][7]
uv = []
for q in pts:
    c = Ti @ np.r_[q, 1]
    uv.append((fx * c[0] / -c[2] + cx, fy * c[1] / c[2] + cy))
img = Image.open(f"{src}/{p['file']}").convert('RGB')
# PIL perspective: coefficients mapping output (x, y) → input; solve from the 4 correspondences
dst = [(0, 0), (W, 0), (W, H), (0, H)]
A, b = [], []
for (x, y), (u, v) in zip(dst, uv):
    A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
    b += [u, v]
coef = np.linalg.solve(np.array(A, float), np.array(b, float))
img.transform((W, H), Image.PERSPECTIVE, tuple(coef), Image.BICUBIC).save(out)
if check:
    d = ImageDraw.Draw(img)
    d.polygon(uv, outline=(0, 255, 0), width=4)
    img.rotate(-90, expand=True).resize((p['height'] // 2, p['width'] // 2)).save(check)
print(out, [tuple(round(c) for c in q) for q in uv])
