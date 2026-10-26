---
name: scan-to-threejs-ultra
description: Ultra-realistic, long-running multi-agent rebuild of a scanned room from a 3D Model Anything export (zip or session folder) — inventories every object, triangulates it from several photos and the LiDAR, models each area in parallel with adversarial photo-pair reviews until gaps close, then separates standalone items (furniture, each item on it) into tagged objects. Use when the user wants a high-fidelity, photo-accurate or "ultra-realistic" reconstruction, or a massive/many-hour agentic run on a scan. Builds on scan-to-threejs.
---

# Scan to Three.js — ultra fidelity

A scan rebuilt at the highest fidelity the photos allow, by a large fleet of agents over hours. Invoking
this skill is the user's opt-in to a Workflow run with many agents; say so in one line, with the area
count, before launching. Load `scan-to-threejs` first: its references (format, modeling, advanced
modeling) apply throughout and are not repeated here.

`U` below is this skill's directory, `S` is `scan-to-threejs/scripts`. Run from the project root.

## 1. Unpack and scaffold (orchestrator, inline)

1. Unzip into a new folder under `data/captures-in/<room-id>/` (ignored input). Find the session folder
   (the one with `manifest.json`); for a whole-house export use `S/house_to_rooms.py` first
   (see `house-capture.md`). Pick the room index from the manifest.
2. Check whether the room already exists (`demos/`, `data/demos/`): a new capture of a different room
   gets a new id; never overwrite another room.
3. `U/scripts/scaffold.sh <session dir> <room-id> "<Label>"`. It converts the room, prepares photos,
   copies the mesh, builds the room-space mesh arrays and fused-depth heightfield, writes `dims.ts`
   and the room module from `assets/room/` (areas auto-loaded from `areas/*.ts`, each isolated by
   try/catch; `?areas=` / `?hideAreas=` for isolation). Register the module in `demos/index.ts`.
   Keep personal rooms out of Git the way the project already does (`.gitignore`, or
   `.git/info/exclude` for `demos/<id>/`, `data/demos/<id>/`, `data/web-assets/<id>/`).
4. Start the dev server (preview_start, `.claude/launch.json`), render a few matched pairs with
   `S/cmp_photo.sh`, and confirm the framing lines up before anything else.

## 2. Plan the areas (orchestrator, inline)

Look at `data/captures/<id>/photos.jpg`, `plan.png`, the heightfield and a dozen full-size photos.
Split the room into areas of roughly 3–10 major objects each (one builder holds one area in mind):
always `shell` (walls, floor, ceiling, openings, global light, exposure), then e.g. bed, desk + its
shelves, chair, wardrobe + door, window + ceiling fixtures + wall art, floor clutter. Split dense
areas further (a bookshelf full of items can be its own area). For each area pick its best photos
(`U/scripts/tools/best_photos.py`). Write `demos/<id>/BRIEF.md` from `assets/BRIEF.template.md`
with real values (walls, light, ownership table). Create no area files; builders do.

## 3. Launch the workflow

Load the `workflow-authoring` skill, then run the bundled script:

```
Workflow({ scriptPath: "<U>/scripts/workflow.js", args: {
  root: "<abs project root>", room: "<id>",
  areas: [{ key: "shell", what: "…", photos: [..] }, { key: "bed", what: "…every object in it…", photos: [..] }, …],
  maxRounds: 5, target: 8.5, objectBatch: 5, roomRounds: 3, separate: true, maxConcurrent: 8 } })
```

What it does, per area and without barriers between areas:

1. **Inventory** — a scout enumerates every object down to small items, triangulates each from ≥ 2
   photos plus LiDAR, and records its best photo set (`data/captures/<id>/inventory/<area>.json`).
2. **Build & review** — the builder models every inventoried object; then three adversarial lens
   reviewers (geometry, surfaces, completeness) and fit-and-finish reviewers (one per `objectBatch`
   objects, each comparing every object against its own photo pairs) report verified gaps with
   evidence. Gaps go back to the builder. Repeats until the worst score ≥ `target` with no major gap
   (minimum two rounds, at most `maxRounds`).
3. **Whole-room critique** — composition, least-realistic-photos and unowned-objects critics; owning
   areas fix and are re-reviewed; repeats until no major gap or `roomRounds`.
4. **Separation** (once fidelity is final) — each standalone thing becomes its own top-level object
   with `userData.item` (`ItemTag` in `part.ts`: id, label, restsOn, confidence, photos) and
   `userData.physics` (`packages/room-physics/tagging.ts`): furniture that nothing is fused to, each
   item on it, each item in or on those. Only high/medium-confidence separations; fused heaps stay
   whole. A regression reviewer diffs before/after renders (must be visually identical) and a
   completeness reviewer hunts missed or wrong separations.

`maxConcurrent` caps agents (each runs its own headless WebGL renderer) so the machine stays usable;
raise it only on a machine with headroom. Ask the app to keep the computer awake for the run.

## 4. While it runs, and after

- Do not edit area files while builders own them. If a builder reports a request for an orchestrator
  file (`index.ts`, `part.ts`, `dims.ts`), apply it between rounds.
- Interrupted (crash, quit)? Restart the dev server, check the TypeScript, and resume with
  `Workflow({ scriptPath, resumeFromRunId })`: finished agents return cached results; agents that were
  mid-task restart from the files as they are on disk.
- When it finishes: delete `areas/placeholders.ts` once no RoomPlan box remains needed, run
  `npm run build`, check the viewer (Rebuilt / Scan / Overlay, walk, cutaway) and the console, and
  render a final set of matched pairs across the room. Report the per-area scores, the item count from
  separation, what is measured vs approximate, the remaining gaps, and send the comparison sheet.
