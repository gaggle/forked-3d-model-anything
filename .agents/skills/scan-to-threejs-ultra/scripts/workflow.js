export const meta = {
  name: 'scan-to-threejs-ultra',
  description: 'Long multi-agent high-fidelity room rebuild: inventory, per-area build with adversarial review loops, whole-room critique, object separation',
  whenToUse: 'After scan-to-threejs-ultra scaffolding: demos/<room>/ exists with BRIEF.md and an area list',
  phases: [
    { title: 'Inventory', detail: 'per area: enumerate and triangulate every object, collect its photo set' },
    { title: 'Build & review', detail: 'per area: model, then area lenses + per-object fit-and-finish critics, until the target score' },
    { title: 'Whole-room critique', detail: 'cross-area critics, area fixes, until no major gaps' },
    { title: 'Separation', detail: 'split each area into standalone tagged items; adversarial no-regression + completeness review' },
  ],
}

// args: { root, room, areas: [{ key, what, photos?: number[] }], maxRounds?, target?, objectBatch?,
//         roomRounds?, separate?, maxConcurrent? }
// Area 'shell' owns demos/<room>/shell.ts; every other area owns demos/<room>/areas/<key>.ts.
const A = args || {}
if (!A.root || !A.room || !Array.isArray(A.areas) || !A.areas.length) throw new Error('args need root, room and areas[]')
const ROOT = A.root, ROOM = A.room
const MAX_ROUNDS = A.maxRounds ?? 5
const TARGET = A.target ?? 8.5
const OBJECT_BATCH = A.objectBatch ?? 5
const ROOM_ROUNDS = A.roomRounds ?? 3
const SEPARATE = A.separate ?? true
const SEP_ROUNDS = 3
const fileOf = (a) => (a.key === 'shell' ? `demos/${ROOM}/shell.ts` : `demos/${ROOM}/areas/${a.key}.ts`)
const AREAS = A.areas.map((a) => ({ ...a, file: fileOf(a), photos: a.photos || [] }))
const CAPS = `data/captures/${ROOM}`

// Every agent renders WebGL in its own headless browser: cap how many run at once so the machine
// stays responsive (an earlier run with 16 concurrent renderers took a laptop down).
let running = 0
const waiting = []
async function run(prompt, opts) {
  if (running >= (A.maxConcurrent ?? 8)) await new Promise((r) => waiting.push(r))
  running++
  try { return await agent(prompt, opts) } finally { running--; waiting.shift()?.() }
}

const COMMON = `You are one worker in a long, quality-first, ultra-realistic three.js reconstruction of a real room from an iPhone LiDAR scan plus posed photos.
Repo: ${ROOT}. Room id: ${ROOM}. Read demos/${ROOM}/BRIEF.md first and follow it exactly: file ownership, measurement tools, unique CAP_SESSION/CAP_OUT per worker, the shared dev server you must never start or stop, and never leaving the TypeScript broken.
Browser hygiene: each CAP_SESSION is a background agent-browser daemon with its own headless Chrome (1-2 GB). Use only the CAP_SESSION name(s) given to you, never invent extra ones, and before your final answer close every session you used: \`devenv shell -- agent-browser --session <name> close\`.`

const GAP = {
  type: 'object',
  properties: {
    object: { type: 'string', description: 'object id from the inventory, or "area"' },
    severity: { type: 'string', enum: ['major', 'minor'] },
    issue: { type: 'string' },
    evidence: { type: 'string', description: 'photo numbers and where in them; measured numbers' },
    fix: { type: 'string', description: 'concrete, measurable fix' },
  },
  required: ['object', 'severity', 'issue', 'evidence', 'fix'],
}
const REVIEW = {
  type: 'object',
  properties: {
    score: { type: 'number', description: '0-10 vs the photos (10 = indistinguishable at normal viewing distance)' },
    gaps: { type: 'array', items: GAP },
  },
  required: ['score', 'gaps'],
}
const INVENTORY = {
  type: 'object',
  properties: {
    objects: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, label: { type: 'string' },
      center: { type: 'array', items: { type: 'number' } }, size: { type: 'array', items: { type: 'number' } },
      photos: { type: 'array', items: { type: 'number' }, description: 'best photos showing it, best first, 3-8' },
      restsOn: { type: 'string' }, notes: { type: 'string', description: 'construction, materials, graphics, uncertainty' },
    }, required: ['id', 'label', 'photos', 'notes'] } },
  },
  required: ['objects'],
}

const LENSES = [
  ['geometry', 'GEOMETRY & MEASUREMENT: positions, sizes, proportions, silhouettes, construction (edges, bevels, joints, handles, gaps, thickness), object counts, alignment across several photos. Prove mismatches in centimetres with ray.py/probe.py/heightfield.'],
  ['surface', 'SURFACES, MATERIALS & LIGHT: albedo (region_stats.py over 3+ photos), roughness/sheen, grain/weave scale and direction, folds and wrinkles, printed graphics and labels, texture resolution, baked shadows, contact shadows, anything that reads CG-clean or flat.'],
  ['completeness', 'COMPLETENESS & CONTEXT: objects in the photos that are missing or merged, wrong counts (books, magnets, cables, clutter), floating or interpenetrating objects, gaps to walls/floor, things in the wrong area or duplicated by another area.'],
]

const gapList = (gaps) => gaps.map((g, i) => `${i + 1}. [${g.severity}] ${g.object}: ${g.issue} — evidence: ${g.evidence} — fix: ${g.fix}`).join('\n')
const capFor = (who) => `CAP_SESSION=${ROOM}-${who} CAP_OUT=${CAPS}/${who}`

function inventoryPrompt(a) {
  return `${COMMON}

SCOUT (do not edit source). Area: ${a.key} — ${a.what}. Starting photos: ${a.photos.join(' ') || 'find them with best_photos.py'}.
Enumerate EVERY distinct physical object in this area, down to small items (each book, pen, magnet, cable, bottle, garment), using full-size photos and zoomed crops. For each: triangulate its centre and size from at least two photos (ray.py) plus the LiDAR (probe.py, heightfield), list the 3-8 photos that show it best (best_photos.py), say what it rests on, and note construction, materials, graphics and uncertainty. Also save the list to ${CAPS}/inventory/${a.key}.json.`
}

function buildPrompt(a, inv, round, gaps) {
  return `${COMMON}

BUILDER. Area: ${a.key} — ${a.what}. You own ${a.file} (create it if missing; areas/*.ts default-export an async function returning a Part) and textures data/web-assets/${ROOM}/textures/${a.key}-*. Round ${round}.
Inventory (scout's measurements; re-verify anything that disagrees with the photos): ${CAPS}/inventory/${a.key}.json — ${inv.objects.length} objects: ${inv.objects.map((o) => o.id).join(', ')}.
${round === 1 ? 'Replace any placeholder for this area (if areas/placeholders.ts still draws a RoomPlan box for it, report that so the orchestrator removes it). Model every inventoried object as its own named Object3D with correct construction, then refine materials and surface detail.' : 'Continue refining toward photographic realism.'}
${gaps.length ? `Adversarial reviewers found these gaps. Close them all, largest first, verifying each against the cited photos:\n${gapList(gaps)}` : ''}
Work loop: render matched-camera pairs (${capFor(`build-${a.key}`)}; use CAP_QUERY=areas=${a.key} to isolate your area with the shell when useful) → inspect full size and zoomed crops → fix the largest discrepancy → repeat. Stop only when you cannot find a discrepancy you can fix in your files.
Final answer (≤250 words): what changed, key measurements with evidence, what remains approximate, requests for files you don't own.`
}

function lensPrompt(a, lens, text, round) {
  return `${COMMON}

ADVERSARIAL REVIEWER (do not edit source). Area: ${a.key} — ${a.what} (${a.file}). Round ${round}. Lens: ${text}
Assume it is not yet photorealistic. Render fresh pairs yourself (${capFor(`rev-${a.key}-${lens}`)}) for the area's photos and any others that show it, inspect at full size and zoomed, read the source. Report only gaps verified in at least one photo (prefer several), with concrete fixes. Score honestly: 8+ only if a casual viewer could mistake the render for the photo.`
}

function objectPrompt(a, objs, round, batch) {
  return `${COMMON}

FIT-AND-FINISH REVIEWER (do not edit source). Area: ${a.key} (${a.file}). Round ${round}. Review these objects one by one, each against its own photo pairs:
${objs.map((o) => `- ${o.id} (${o.label}): photos ${o.photos.join(' ')}; ${o.notes}`).join('\n')}
For each object render its photos (${capFor(`obj-${a.key}-${batch}`)}), crop both sides to the object at the same box, and compare silhouette, size, position, construction, edges, hardware, materials, graphics and how it sits on its support. Be adversarial and specific (cm, colours, counts). Score = the worst object's realism.`
}

async function review(a, inv, round) {
  const batches = []
  for (let i = 0; i < inv.objects.length; i += OBJECT_BATCH) batches.push(inv.objects.slice(i, i + OBJECT_BATCH))
  const rs = await parallel([
    ...LENSES.map(([k, t]) => () => run(lensPrompt(a, k, t, round), { label: `rev:${a.key}:${k}:r${round}`, phase: 'Build & review', schema: REVIEW })),
    ...batches.map((objs, b) => () => run(objectPrompt(a, objs, round, b), { label: `obj:${a.key}:${b}:r${round}`, phase: 'Build & review', schema: REVIEW })),
  ])
  const ok = rs.filter(Boolean)
  if (ok.length < rs.length) log(`${a.key} r${round}: ${rs.length - ok.length} reviewer(s) returned nothing`)
  return { score: ok.length ? Math.min(...ok.map((r) => r.score)) : 0, gaps: ok.flatMap((r) => r.gaps) }
}

const state = {}

// Inventory → build/review loop, per area, no barrier between areas
const areaResults = await pipeline(
  AREAS,
  (a) => run(inventoryPrompt(a), { label: `inventory:${a.key}`, phase: 'Inventory', schema: INVENTORY }),
  async (inv, a) => {
    inv = inv && inv.objects.length ? inv : { objects: [{ id: a.key, label: a.key, photos: a.photos, notes: a.what }] }
    let gaps = []
    const rounds = []
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const summary = await run(buildPrompt(a, inv, round, gaps), { label: `build:${a.key}:r${round}`, phase: 'Build & review' })
      const rev = await review(a, inv, round)
      const majors = rev.gaps.filter((g) => g.severity === 'major').length
      rounds.push({ round, score: rev.score, majors, gaps: rev.gaps.length, summary })
      log(`${a.key} r${round}: score ${rev.score}, ${majors} major / ${rev.gaps.length} gaps`)
      gaps = rev.gaps
      if (round >= 2 && rev.score >= TARGET && !majors) break
    }
    state[a.key] = { inv, remaining: gaps }
    return { area: a.key, objects: inv.objects.length, rounds }
  },
)

// Whole-room critique until dry
const ROOM_GAPS = {
  type: 'object',
  properties: { gaps: { type: 'array', items: { ...GAP, properties: { ...GAP.properties, area: { type: 'string', enum: AREAS.map((a) => a.key) } }, required: [...GAP.required, 'area'] } } },
  required: ['gaps'],
}
const CRITICS = [
  'Composition: render ~20 photos spread over the whole room and find anything missing, misplaced, floating, interpenetrating, duplicated between areas, or inconsistent in scale, exposure or colour between areas.',
  'Ultra-realism: find the 12 photos where the model looks least real and name the specific causes (flat materials, missing micro-detail, CG-clean edges, wrong shadows/contact, missing clutter, low texture resolution).',
  'Unowned things: list every object or surface visible in the photos that no area models well (check each photo systematically), and assign each to the most suitable area.',
]
const roomLog = []
for (let r = 1; r <= ROOM_ROUNDS; r++) {
  const found = (await parallel(CRITICS.map((t, i) => () => run(`${COMMON}\n\nADVERSARIAL WHOLE-ROOM CRITIC (do not edit source), round ${r}. ${t} Use ${capFor(`room-critic-${r}-${i}`)}. Assign each gap to the area that owns the fix (BRIEF.md ownership).`, { label: `room-critic:${i}:r${r}`, phase: 'Whole-room critique', schema: ROOM_GAPS }))))
    .filter(Boolean).flatMap((c) => c.gaps)
  const majors = found.filter((g) => g.severity === 'major').length
  log(`whole-room r${r}: ${found.length} gaps (${majors} major)`)
  const fixes = await parallel(AREAS.map((a) => async () => {
    state[a.key] ??= { inv: { objects: [] }, remaining: [] }
    const g = [...found.filter((x) => x.area === a.key), ...(r === 1 ? state[a.key]?.remaining || [] : [])]
    if (!g.length) return null
    await run(buildPrompt(a, state[a.key]?.inv || { objects: [] }, `room-${r}`, g), { label: `fix:${a.key}:room-r${r}`, phase: 'Whole-room critique' })
    const rev = await review(a, state[a.key]?.inv || { objects: [] }, `room-${r}`)
    state[a.key].remaining = rev.gaps
    return { area: a.key, score: rev.score, gaps: rev.gaps.length }
  }))
  roomLog.push({ round: r, gaps: found.length, majors, after: fixes.filter(Boolean) })
  if (!majors) break
}

// Separation: standalone items become their own tagged objects, with no visual change
const SEP = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'true only if renders are visually unchanged and nothing separable was missed' },
    problems: { type: 'array', items: { type: 'string' } },
    items: { type: 'number', description: 'tagged items counted in the area' },
  },
  required: ['ok', 'problems'],
}
let separation = []
if (SEPARATE) {
  separation = await pipeline(
    AREAS.filter((a) => a.key !== 'shell'),
    async (a) => {
      let problems = []
      let last = null
      for (let r = 1; r <= SEP_ROUNDS; r++) {
        await run(`${COMMON}

SEPARATOR. Area: ${a.key} (${a.file}). Round ${r}. The area is now at its final fidelity; your job is structure, not appearance.
${r === 1 ? `First render the area's photos to ${CAPS}/sep-before/${a.key} (CAP_SESSION=${ROOM}-sep-${a.key}) as the baseline.` : `Baseline renders are in ${CAPS}/sep-before/${a.key}.`}
Make every physically standalone thing its own top-level Object3D: furniture without clutter fused to it, each item resting on it, each item resting on those (a desk; each book, pen, pencil, cup on it; a box on the floor and each thing in it). Separate only where the photos give high or medium confidence that it is a distinct object; leave fused or ambiguous heaps whole and say why. For each item set userData.item = ItemTag (part.ts: id like '${a.key}/pencil-03', label, restsOn, confidence, photos) and userData.physics per packages/room-physics/tagging.ts (dynamic for movable items with a sensible mass/shape/surface, static for fixed furniture and built-ins, none for cables/cloth heaps that cannot simulate). Keep supports as parents only where the item must move with them; otherwise siblings with restsOn. Geometry and materials must not change: re-render the same photos and diff against the baseline (pixel diff per photo; investigate any visible change). Save the item list to ${CAPS}/items/${a.key}.json.
${problems.length ? `Reviewers found:\n${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : ''}`, { label: `separate:${a.key}:r${r}`, phase: 'Separation' })
        const vs = (await parallel([
          ['regression', `Render the same photos as ${CAPS}/sep-before/${a.key} and diff them (pixel diff and zoomed crops): report any visible change in geometry, material, position or shadow caused by the separation.`],
          ['completeness', `Hunt for standalone objects that are still fused into a larger mesh or group (go photo by photo), items wrongly separated where the photos show them attached, wrong restsOn links, missing or unreasonable physics tags, and duplicate ids.`],
        ].map(([k, t]) => () => run(`${COMMON}\n\nADVERSARIAL SEPARATION REVIEWER (do not edit source). Area: ${a.key} (${a.file}), ${ROOM}. ${t} Use ${capFor(`sep-rev-${a.key}-${k}`)}. ok=true only if you found nothing.`, { label: `sep-rev:${a.key}:${k}:r${r}`, phase: 'Separation', schema: SEP })))).filter(Boolean)
        problems = vs.flatMap((v) => v.problems)
        last = { round: r, ok: vs.length === 2 && vs.every((v) => v.ok), items: Math.max(0, ...vs.map((v) => v.items || 0)), problems }
        log(`separation ${a.key} r${r}: ${last.ok ? 'clean' : `${problems.length} problems`}, ~${last.items} items`)
        if (last.ok) break
      }
      return { area: a.key, ...last }
    },
  )
}

return {
  areas: areaResults.filter(Boolean),
  room: roomLog,
  remaining: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, v.remaining])),
  separation: separation.filter(Boolean),
}
