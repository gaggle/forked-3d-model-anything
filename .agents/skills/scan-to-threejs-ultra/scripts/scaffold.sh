#!/bin/zsh
# Set up a new high-fidelity room from an unpacked session bundle (the folder holding manifest.json).
# usage: scaffold.sh <session dir> <room-id> "<Label>" [room index, default: the manifest's first room]
# Run from the project root. Needs Python with NumPy + Pillow ($PY, else .devenv's, else python3).
# Creates (refusing to overwrite): data/demos/<id>/{scan.json,plan.png}, data/web-assets/<id>/{photos,scan},
# data/captures/<id>/{mesh_*.npy,hf.npz,photos.jpg}, demos/<id>/ (room module from the template).
set -e
SKILL=${0:A:h:h}
BASE=$SKILL/../scan-to-threejs/scripts
T=$SKILL/scripts/tools
SRC=${1:?session dir}; ID=${2:?room id}; LABEL=${3:?label}
: ${PY:=$([[ -x .devenv/profile/bin/python3 ]] && echo .devenv/profile/bin/python3 || echo python3)}
IDX=${4:-$($PY -I -c "import json,sys; print(json.load(open(sys.argv[1]))['rooms'][0]['index'])" $SRC/manifest.json)}
for d in demos/$ID data/demos/$ID data/web-assets/$ID; do [[ -e $d ]] && { echo "$d exists; choose another room id"; exit 1; }; done
mkdir -p data/demos/$ID data/web-assets/$ID/scan data/captures/$ID

$PY -I $BASE/bundle_to_room.py $SRC --room $IDX -o data/demos/$ID/scan.json --plan data/demos/$ID/plan.png
$PY -I $BASE/prepare_photos.py $SRC data/demos/$ID/scan.json data/web-assets/$ID/photos
$PY -I $T/photo_sheet.py data/web-assets/$ID/photos data/captures/$ID/photos.jpg
PLY=$SRC/mesh/room-$IDX.ply
if [[ -s $PLY ]]; then
  cp $PLY data/web-assets/$ID/scan/room.ply
  [[ -f $SRC/mesh/room-$IDX-colors.bin ]] && cp $SRC/mesh/room-$IDX-colors.bin data/web-assets/$ID/scan/room-colors.bin
  $PY -I $T/mesh.py $PLY data/demos/$ID/scan.json data/captures/$ID/mesh
else
  echo "no LiDAR mesh in this bundle: Scan/Overlay and probe/ray need another reference (see scan-to-threejs house-capture.md)"
fi
[[ -f $SRC/depth/frames.json ]] && $PY -I $T/heightfield.py $SRC data/demos/$ID/scan.json data/captures/$ID/hf.npz

mkdir -p demos/$ID/areas
EXPORT=$(print -r -- $ID | $PY -I -c "import sys; p=sys.stdin.read().strip().split('-'); print(p[0]+''.join(w.title() for w in p[1:]))")
for f in index.ts part.ts placeholder.ts shell.ts areas/placeholders.ts; do
  sed -e "s#__ROOM__#$ID#g" -e "s#__EXPORT__#$EXPORT#g" -e "s#__LABEL__#$LABEL#g" $SKILL/assets/room/$f > demos/$ID/$f
done
# dims.ts: wall table + ceiling from the mesh height histogram (falls back to RoomPlan's wall height)
$PY -I - data/demos/$ID/scan.json data/captures/$ID/mesh_P.npy > demos/$ID/dims.ts <<'PY'
import sys, json, os, numpy as np
s = json.load(open(sys.argv[1])); poly = np.array(s['polygon']); h = s['walls'][0]['height']; how = "RoomPlan's wall height"
if os.path.exists(sys.argv[2]):
    P = np.load(sys.argv[2]); lo, hi = poly.min(0) + 0.3, poly.max(0) - 0.3
    k = (P[:, 0] > lo[0]) & (P[:, 0] < hi[0]) & (P[:, 2] > lo[1]) & (P[:, 2] < hi[1]) & (P[:, 1] > h - 0.5) & (P[:, 1] < h + 0.3)
    if k.sum() > 500:
        c, e = np.histogram(P[k, 1], bins=80); h = float(e[c.argmax()] + (e[1] - e[0]) / 2); how = 'LiDAR mesh height histogram peak'
print('/**\n * Room measurements (room coordinates, meters, floor y = 0, room centred). Walls from RoomPlan.')
for w in s['walls']:
    o, u, n = w['origin'], w['u'], w['n']
    ops = '; '.join(f"{p['kind']} u {p['u0']:.2f}–{p['u1']:.2f} v {p['v0']:.2f}–{p['v1']:.2f}" for p in w['openings'])
    print(f" *   wall {w['index']}: origin ({o[0]:.3f}, {o[2]:.3f}) u ({u[0]:.0f}, {u[2]:.0f}) n ({n[0]:.0f}, {n[2]:.0f}) length {w['length']:.3f}{'  ' + ops if ops else ''}")
print(f' * Ceiling: {how}.\n */')
print(f'export const HX = {poly[:, 0].max():.4f}, HZ = {poly[:, 1].max():.4f};')
print(f'export const HEIGHT = {h:.3f};')
PY
echo
echo "demos/$ID ready (export $EXPORT). Next: register it in demos/index.ts, keep personal files out of git, look at data/captures/$ID/photos.jpg and plan.png."
