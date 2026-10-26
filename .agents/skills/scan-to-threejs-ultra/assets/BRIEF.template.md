# <Label> reconstruction brief (shared by all workers)

Goal: an ultra-realistic rebuild of this room that matches its posed photos as closely as physically
possible: silhouettes, sizes, positions, construction (joints, edges, bevels, gaps, hardware),
material colour, roughness/sheen, texture scale, surface graphics (labels, prints, book spines,
photos, patterns) and how things line up across *several* photos. Quality first; no time pressure.
Triangulate every object from at least two photos plus the LiDAR before committing a dimension.

## Project facts

- Repo root: `<root>`. Room module: `demos/<room>/`. Run every command from the repo root.
  Python with NumPy/Pillow: `<python> -I`. Tools: `T=.agents/skills/scan-to-threejs-ultra/scripts/tools`,
  `S=.agents/skills/scan-to-threejs/scripts`.
- Dev server already runs at `<cap-url>` (hot reload). Never start or stop it.
- Coordinates: meters, +y up, floor y = 0, room centred. Walls and ceiling: `demos/<room>/dims.ts`.
  <one line per wall: index, side, coordinate, u direction, what is on it>
- Light: <daylight / artificial; white balance and exposure notes>. Photos use per-frame auto
  exposure: judge colour across several photos, never one.
- Photos: upright JPEGs `data/web-assets/<room>/photos/NNNN.jpg` (index = photo #); raw frames and
  intrinsics in `<session dir>/photos/photos.json` (same order). All photos: `data/captures/<room>/photos.jpg`.
  Close-up poses can drift 5–10 cm: prefer agreement across photos and the LiDAR.
- Area modules: `areas/<key>.ts` default-exports `async () => Part` (`part.ts`): `room` objects in
  room coordinates, `walls[i]` for things on wall i (hidden with it in the cutaway), `ceiling`,
  `lights`. Every top-level object gets a descriptive `name`. Preload image textures inside the module.
- Helpers: `packages/room-runtime/helpers.ts` (mesh, box, cushion, sweep, lathe, tube, pillow, boxUV);
  guidance: `.agents/skills/scan-to-threejs/references/modeling.md` and `advanced-modeling.md`.
- Textures: `data/web-assets/<room>/textures/<area>-*.jpg` (served at `/<room>/textures/...`).
  Rectified photo crops are encouraged for flat graphics; neutralise baked lighting (`to_albedo.py`).
  ≤ 2048 px each, < 8 MB per area.
- **Never break the room for others**: one page is shared. After each edit run
  `npx tsc --noEmit -p . 2>&1 | grep demos/<room>` (must print nothing) and confirm a render works.

## Rendering and measuring

```sh
devenv shell -- zsh -c 'CAP_URL=<cap-url> CAP_SESSION=<room>-<you> CAP_OUT=data/captures/<room>/<you> $S/cmp_photo.sh <room> 12 40 77'
```

Each `CAP_SESSION` is a background agent-browser daemon with its own headless Chrome (1–2 GB). Use only
the session name you were given, and close it before you finish:
`devenv shell -- agent-browser --session <room>-<you> close`. Idle daemons exit after 10 minutes.

Outputs `ph-<room>-N-cmp.jpg` (photo | model) and the uncropped `ph-<room>-N-model.png`. Inspect at
full size and with PIL crops. `CAP_QUERY=areas=desk` renders only those areas plus the shell (`hideAreas=` to
drop some). Free camera: `$S/cap.sh <name> 'room=<room>&src=model&cam=x,y,z&look=x,y,z&fov=60&size=1300x850'`.

- `$T/best_photos.py data/demos/<room>/scan.json x,y,z [n]` photos that see a room point, best first.
- `$T/ray.py data/captures/<room>/mesh data/demos/<room>/scan.json <photo#>:fx:fy …` where an upright
  pixel (0–1 fractions) hits the LiDAR mesh. Two+ photos triangulate.
- `$T/probe.py data/captures/<room>/mesh name=x0,x1,y0,y1,z0,z1` LiDAR vertex extents in a box.
  Arrays: `data/captures/<room>/mesh_{P,F,C,K}.npy` (vertices, faces, colours, face class).
- `data/captures/<room>/hf.npz` fused-depth heightfield (h, count, x0, z0, res; top surface below 2 m).
  Raw depth: `<session dir>/depth/frames.json`, `.f16z` = raw-DEFLATE float16 m (`zlib.decompress(b, -15)`).
- `$T/rectify.py <session dir> data/demos/<room>/scan.json <photo#> out.png WxH TL TR BR BL [--check c.jpg]`
  unwarp a planar face from room-space corners.
- `$T/to_albedo.py in out '#base' [--ref x0,y0,x1,y1 | --base r,g,b]` neutralise a crop.
- `$T/region_stats.py <room> <cmp dir> <photo#> x0,y0,x1,y1 …` photo vs model mean sRGB. Calibrate
  over 3+ photos: linear ratio ≈ sRGB ratio^2.2, scale the albedo, recheck.
- `$T/sheet.py <room> <cmp dir> <out.jpg> <photo#…>` contact sheet of pairs.

## Ownership (edit only your files; report anything else as a request)

| area | files | covers | photos |
|------|-------|--------|--------|
| shell | `shell.ts` | walls, paint, floor, skirting, ceiling, openings' reveals, global lights, exposure | … |
| <key> | `areas/<key>.ts` | … | … |

Orchestrator owns `index.ts`, `part.ts`, `dims.ts`, `placeholder.ts`, `areas/placeholders.ts`.
