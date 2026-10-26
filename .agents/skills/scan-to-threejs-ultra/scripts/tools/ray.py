"""3D point where an upright-image pixel hits the LiDAR mesh.
usage: ray.py data/captures/<room>/mesh data/demos/<room>/scan.json <photo#>:fx:fy ...   (fx, fy: 0–1 fractions of the upright photo)
Use two or more photos of the same feature to triangulate; close-up poses can drift 5–10 cm."""
import sys,json,numpy as np
pre,scanj,*args=sys.argv[1:]
P=np.load(pre+'_P.npy'); s=json.load(open(scanj))
for a in args:
    i,fx,fy=(a.split(':')+['0.5','0.5'])[:3]; i=int(i); fx=float(fx); fy=float(fy)
    p=s['photos'][i]; o=np.array(p['position']); f=np.array(p['forward']); up=np.array(p['up']); r=np.cross(f,up)
    t=np.tan(np.radians(p['fovY'])/2); d=f+(2*fx-1)*t*p['aspect']*r+(1-2*fy)*t*up; d/=np.linalg.norm(d)
    v=P-o; along=v@d; perp=np.linalg.norm(v-np.outer(along,d),axis=1)
    k=(along>0.2)&(perp<0.02+0.01*along)
    hit=o+d*along[k].min() if k.any() else None
    print(i,(fx,fy),'cam',o.round(2),'fwd',f.round(2),'hit',None if hit is None else hit.round(2))
