#!/usr/bin/env python3
"""LiDAR PLY → room space: mesh.py <ply> <scan.json> <out prefix>  writes <prefix>_P.npy (verts), _F.npy (faces), _C.npy (rgb), _K.npy (face class)."""
import sys, json, numpy as np
ply, scanj, pre = sys.argv[1:4]
raw = open(ply, 'rb').read(); end = raw.index(b'end_header\n') + 11
hdr = raw[:end].decode(); nv = int(hdr.split('element vertex ')[1].split()[0]); nf = int(hdr.split('element face ')[1].split()[0])
vt = np.dtype([('x','<f4'),('y','<f4'),('z','<f4'),('nx','<f4'),('ny','<f4'),('nz','<f4'),('cov','<f4'),('r','u1'),('g','u1'),('b','u1'),('inroom','u1')])
V = np.frombuffer(raw, vt, nv, end)
ft = np.dtype([('n','u1'),('i','<u4',3),('c','u1')])
F = np.frombuffer(raw, ft, nf, end + nv * vt.itemsize)
M = np.array(json.load(open(scanj))['transform']['worldToRoom']).reshape(4, 4).T
P = np.stack([V['x'], V['y'], V['z'], np.ones(nv)]).astype(np.float64)
P = (M @ P)[:3].T.astype(np.float32)
np.save(pre + '_P.npy', P); np.save(pre + '_F.npy', F['i'].astype(np.int32)); np.save(pre + '_K.npy', F['c'])
np.save(pre + '_C.npy', np.stack([V['r'], V['g'], V['b']], 1))
print(nv, 'verts', nf, 'faces; bounds', P.min(0).round(2), P.max(0).round(2))
