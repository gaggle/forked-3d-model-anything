"""LiDAR mesh vertex extents in a room-space box: probe.py data/captures/<room>/mesh name=x0,x1,y0,y1,z0,z1 ..."""
import sys,numpy as np
pre=sys.argv[1]; P=np.load(pre+'_P.npy')
for spec in sys.argv[2:]:
    name,b=spec.split('='); x0,x1,y0,y1,z0,z1=map(float,b.split(','))
    k=(P[:,0]>=x0)&(P[:,0]<=x1)&(P[:,1]>=y0)&(P[:,1]<=y1)&(P[:,2]>=z0)&(P[:,2]<=z1); Q=P[k]
    if not len(Q): print(name,'none'); continue
    pc=np.percentile(Q,[2,50,98],axis=0)
    print(f'{name}: n={len(Q)} x {pc[0,0]:.2f}..{pc[2,0]:.2f} y {pc[0,1]:.2f}..{pc[2,1]:.2f} z {pc[0,2]:.2f}..{pc[2,2]:.2f}')
