#!/usr/bin/env python3
"""Fuse the session's LiDAR depth frames into a room-space heightfield (top surface per cell).

usage: heightfield.py <session dir> <scan.json> <out.npz> [--res 0.01] [--max-y 2.0]
Keeps confidence-2 depth within 3 m, transforms it into room coordinates (scan.json worldToRoom)
and stores, per x/z cell, a robust top height (85th percentile of points below --max-y).
Bounds come from the room polygon. Output: h (H×W, NaN = no data), count, x0, z0, res.
"""
import sys, json, zlib, numpy as np
src, scanj, out = sys.argv[1:4]
arg = lambda k, d: float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
res, max_y = arg('--res', 0.01), arg('--max-y', 2.0)
scan = json.load(open(scanj))
M = np.array(scan['transform']['worldToRoom']).reshape(4, 4).T
poly = np.array(scan['polygon'])
x0, z0 = poly.min(0) - 0.05; x1, z1 = poly.max(0) + 0.05
frames = json.load(open(f'{src}/depth/frames.json'))
W, H = int(round((x1 - x0) / res)), int(round((z1 - z0) / res))
cells, ys = [], []
for f in frames:
    w, h = f['width'], f['height']
    d = np.frombuffer(zlib.decompress(open(f"{src}/{f['file']}", 'rb').read(), -15), '<f2').astype(np.float32).reshape(h, w)
    c = np.frombuffer(open(f"{src}/{f['confidence']}", 'rb').read(), 'u1').reshape(h, w)
    fx, fy, cx, cy = f['intrinsics'][0], f['intrinsics'][4], f['intrinsics'][6], f['intrinsics'][7]
    v, u = np.mgrid[0:h, 0:w]
    k = (c >= 2) & (d > 0.15) & (d < 3.0)
    dd = d[k]
    P = np.stack([(u[k] - cx) / fx * dd, -(v[k] - cy) / fy * dd, -dd, np.ones_like(dd)])
    R = (M @ np.array(f['transform']).reshape(4, 4).T @ P)[:3]
    keep = (R[1] < max_y) & (R[0] > x0 + 0.03) & (R[0] < x1 - 0.03) & (R[2] > z0 + 0.03) & (R[2] < z1 - 0.03)
    R = R[:, keep]
    cells.append(((R[2] - z0) / res).astype(int) * W + ((R[0] - x0) / res).astype(int)); ys.append(R[1].astype(np.float32))
cells = np.concatenate(cells); ys = np.concatenate(ys)
o = np.lexsort((ys, cells)); cells, ys = cells[o], ys[o]
starts = np.r_[0, np.flatnonzero(np.diff(cells)) + 1]; ends = np.r_[starts[1:], len(cells)]
idx = starts + np.floor((ends - starts - 1) * 0.85).astype(int)
hf = np.full(H * W, np.nan, np.float32); cnt = np.zeros(H * W, np.int32)
hf[cells[starts]] = ys[idx]; cnt[cells[starts]] = ends - starts
np.savez_compressed(out, h=hf.reshape(H, W), count=cnt.reshape(H, W), x0=x0, z0=z0, res=res)
print(f'{len(frames)} frames → {W}×{H} cells, filled {np.isfinite(hf).mean():.1%}')
