#!/usr/bin/env python3
"""Best photos of a room-space point: best_photos.py data/demos/<room>/scan.json x,y,z [n=8]
Ranks photos where the point is in frame (upright fractions printed), by closeness to centre and distance."""
import sys, json, numpy as np
s = json.load(open(sys.argv[1])); P = np.array(list(map(float, sys.argv[2].split(',')))); n = int(sys.argv[3]) if len(sys.argv) > 3 else 8
out = []
for i, p in enumerate(s['photos']):
    o, f, up = map(np.array, (p['position'], p['forward'], p['up'])); r = np.cross(f, up)
    v = P - o; z = v @ f
    if z < 0.15: continue
    t = np.tan(np.radians(p['fovY']) / 2)
    fx = 0.5 + (v @ r) / z / (t * p['aspect']) / 2; fy = 0.5 - (v @ up) / z / t / 2
    if not (0 <= fx <= 1 and 0 <= fy <= 1): continue
    out.append((np.hypot(fx - .5, fy - .5) + 0.25 * z, i, fx, fy, z))
for sc, i, fx, fy, z in sorted(out)[:n]: print(f'photo {i:3d}  at ({fx:.2f},{fy:.2f})  dist {z:.2f} m')
