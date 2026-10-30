import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BuiltRoom } from '../../../packages/room-runtime/types';

/**
 * Inspect mode: orbiting over and under (horizon kept level) around a clicked pivot, object sizes on hover,
 * shift-click to pin them, a two-click tape measure and the room's declared volumes.
 * Everything pinned lives in the URL (`pins`, `tapes`, `volumes`), so a copied view link reopens it.
 * Sizes are the rebuilt model's, not tape-measured: labels carry "≈".
 */

export interface InspectorHost {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  room(): BuiltRoom | undefined;
  /** visible meshes the pointer can hit (model, and the scan when shown) */
  pickables(): THREE.Object3D[];
  /** smooth pivot change, keeping the camera where it is */
  pivot(point: THREE.Vector3): void;
  invalidate(): void;
  requestFrame(): void;
}

type Tool = 'pivot' | 'tape';
/** a box in some frame: local min/max and the frame's world matrix */
interface Frame { min: THREE.Vector3; max: THREE.Vector3; matrix: THREE.Matrix4 }
interface Measure { line: THREE.Object3D; labels: HTMLElement[]; title?: HTMLElement }
interface Pin extends Measure { path: string; object: THREE.Object3D }
interface Tape extends Measure { a: THREE.Vector3; b: THREE.Vector3 }

const COLORS = { hover: '#7fd6ec', pin: '#f2b84b', volume: '#9be27a', tape: '#ff7ad1', pivot: '#ffffff' };
const EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const lineMaterial = (color: string, opacity = 0.95) =>
  new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
const AXIS = ['W', 'H', 'D'] as const;

export const mm = (metres: number) => `≈ ${Math.round(metres * 1000).toLocaleString('en').replace(/,/g, ' ')} mm`;

/** named-path of an object below `root`: duplicate sibling names get @n, unnamed ones #index */
function pathOf(o: THREE.Object3D, root: THREE.Object3D) {
  const segments: string[] = [];
  for (let c = o; c !== root && c.parent; c = c.parent) {
    const siblings = c.parent.children;
    const same = siblings.filter(s => s.name === c.name);
    segments.unshift(!c.name ? `#${siblings.indexOf(c)}` : same.length > 1 ? `${c.name}@${same.indexOf(c)}` : c.name);
  }
  return segments.join('/');
}
function resolvePath(path: string, root: THREE.Object3D) {
  let o: THREE.Object3D | undefined = root;
  for (const segment of path.split('/')) {
    if (!o) return;
    const index = /^#(\d+)$/.exec(segment), nth = /^(.*)@(\d+)$/.exec(segment);
    o = index ? o.children[+index[1]]
      : nth ? o.children.filter(c => c.name === nth[1])[+nth[2]]
      : o.children.find(c => c.name === segment);
  }
  return o === root ? undefined : o;
}

/** tight box of an object's meshes in its own frame (so a rotated part is measured along its sides) */
function frameOf(o: THREE.Object3D): Frame | undefined {
  o.updateWorldMatrix(true, true);
  const inverse = o.matrixWorld.clone().invert();
  const box = new THREE.Box3(), part = new THREE.Box3(), m = new THREE.Matrix4();
  o.traverse(c => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const instanced = mesh as unknown as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) { instanced.computeBoundingBox(); part.copy(instanced.boundingBox!); }
    else { mesh.geometry.boundingBox ?? mesh.geometry.computeBoundingBox(); part.copy(mesh.geometry.boundingBox!); }
    box.union(part.applyMatrix4(m.multiplyMatrices(inverse, mesh.matrixWorld)));
  });
  return box.isEmpty() ? undefined : { min: box.min, max: box.max, matrix: o.matrixWorld.clone() };
}

export function createInspector(host: InspectorHost) {
  const { canvas, camera } = host;
  // Dollhouse's orbit without its floor limit: straight down to straight up, never rolled
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.35;
  controls.rotateSpeed = 0.7;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.minDistance = 0.05;
  controls.maxDistance = 30;
  controls.addEventListener('change', host.invalidate);

  const overlay = new THREE.Scene();
  const viewport = canvas.parentElement!;
  const layer = document.createElement('div');
  layer.className = 'inspect-layer';
  layer.hidden = true;
  const tooltip = document.createElement('div');
  tooltip.className = 'inspect-tooltip';
  tooltip.hidden = true;
  viewport.append(layer, tooltip);

  const panel = document.querySelector<HTMLElement>('#inspect-panel')!;
  const list = panel.querySelector<HTMLElement>('.measure-list')!;
  const volumesToggle = panel.querySelector<HTMLInputElement>('#show-volumes')!;

  let active = false;
  let tool: Tool = 'pivot';
  let level = 0; // how many named parents above the hovered part
  let hover: { object?: THREE.Object3D; point?: THREE.Vector3; parts: THREE.Object3D[] } = { parts: [] };
  let hoverMeasure: Measure | undefined;
  let tapeStart: THREE.Vector3 | undefined;
  let rubber: Measure | undefined;
  const pins: Pin[] = [];
  const tapes: Tape[] = [];
  const volumes: Measure[] = [];

  const pivotDot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: COLORS.pivot, depthTest: false, transparent: true, opacity: 0.85, toneMapped: false }));
  const cursorDot = new THREE.Mesh(pivotDot.geometry,
    new THREE.MeshBasicMaterial({ color: COLORS.tape, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false }));
  cursorDot.visible = false;
  overlay.add(pivotDot, cursorDot);

  const label = (kind: keyof typeof COLORS, text = '') => {
    const el = document.createElement('span');
    el.className = `inspect-label ${kind}`;
    el.textContent = text;
    el.hidden = true; // until the next frame projects it
    layer.append(el);
    return el;
  };

  // --- Boxes: the three edges meeting at the corner nearest the camera carry the sizes ---------

  function boxMeasure(frame: Frame, kind: keyof typeof COLORS, title?: string): Measure {
    const size = frame.max.clone().sub(frame.min);
    const lines = new THREE.LineSegments(EDGES, lineMaterial(COLORS[kind], kind === 'hover' ? 0.8 : 0.95));
    lines.matrixAutoUpdate = false;
    lines.matrix.copy(frame.matrix).multiply(new THREE.Matrix4().compose(
      frame.min.clone().add(frame.max).multiplyScalar(0.5), new THREE.Quaternion(), size.clone().max(new THREE.Vector3(1e-4, 1e-4, 1e-4))));
    lines.renderOrder = 10;
    lines.userData.frame = frame;
    overlay.add(lines);
    return { line: lines, labels: [label(kind), label(kind), label(kind)], title: title ? label(kind, title) : undefined };
  }
  const corner = new THREE.Vector3(), other = new THREE.Vector3(), near = new THREE.Vector3(), mid = new THREE.Vector3();
  function placeBox(m: Measure) {
    const { min, max, matrix } = m.line.userData.frame as Frame;
    let best = Infinity, pick = 0;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(matrix);
      const d = corner.distanceToSquared(camera.position);
      if (d < best) { best = d; pick = i; }
    }
    near.set(pick & 1 ? max.x : min.x, pick & 2 ? max.y : min.y, pick & 4 ? max.z : min.z).applyMatrix4(matrix);
    for (let axis = 0; axis < 3; axis++) {
      const flipped = pick ^ (1 << axis);
      other.set(flipped & 1 ? max.x : min.x, flipped & 2 ? max.y : min.y, flipped & 4 ? max.z : min.z).applyMatrix4(matrix);
      const length = near.distanceTo(other);
      // name the side by the room axis it mostly runs along
      const run = other.clone().sub(near);
      const dominant = Math.abs(run.y) >= Math.abs(run.x) && Math.abs(run.y) >= Math.abs(run.z) ? 1 : Math.abs(run.x) >= Math.abs(run.z) ? 0 : 2;
      const el = m.labels[axis];
      if (length < 0.002) { el.hidden = true; continue; }
      el.textContent = `${AXIS[dominant]} ${mm(length)}`;
      place(el, mid.addVectors(near, other).multiplyScalar(0.5));
    }
    if (m.title) {
      const top = new THREE.Vector3((min.x + max.x) / 2, max.y, (min.z + max.z) / 2).applyMatrix4(matrix);
      place(m.title, top, -14);
    }
  }
  const projected = new THREE.Vector3();
  function place(el: HTMLElement, world: THREE.Vector3, dy = 0) {
    projected.copy(world).project(camera);
    el.hidden = projected.z > 1 || projected.z < -1;
    if (el.hidden) return;
    el.style.transform = `translate(${(projected.x + 1) / 2 * canvas.clientWidth}px, ${(1 - projected.y) / 2 * canvas.clientHeight + dy}px) translate(-50%, -50%)`;
  }
  function removeMeasure(m?: Measure) {
    if (!m) return;
    overlay.remove(m.line);
    m.line.traverse(o => { const l = o as THREE.Line; if (l.isLine || (l as unknown as THREE.Points).isPoints) { if (l.geometry !== EDGES) l.geometry.dispose(); (l.material as THREE.Material).dispose(); } });
    m.labels.forEach(el => el.remove());
    m.title?.remove();
  }

  // --- Tape ---------------------------------------------------------------------------------

  function tapeMeasure(a: THREE.Vector3, b: THREE.Vector3, opacity = 1): Measure {
    const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geometry, lineMaterial(COLORS.tape, opacity));
    const ends = new THREE.Points(geometry.clone(), new THREE.PointsMaterial({ color: COLORS.tape, size: 7, sizeAttenuation: false, depthTest: false, transparent: true, toneMapped: false }));
    line.add(ends);
    line.renderOrder = ends.renderOrder = 11;
    line.userData.ends = [a.clone(), b.clone()];
    overlay.add(line);
    return { line, labels: [label('tape')] };
  }
  function placeTape(m: Measure) {
    const [a, b] = m.line.userData.ends as THREE.Vector3[];
    m.labels[0].textContent = mm(a.distanceTo(b));
    place(m.labels[0], mid.addVectors(a, b).multiplyScalar(0.5));
  }
  function addTape(a: THREE.Vector3, b: THREE.Vector3, save = true) {
    tapes.push({ a: a.clone(), b: b.clone(), ...tapeMeasure(a, b) });
    if (save) changed();
  }

  // --- Pins and volumes -----------------------------------------------------------------------

  function addPin(object: THREE.Object3D, save = true) {
    const room = host.room();
    const frame = frameOf(object);
    if (!room || !frame) return;
    pins.push({ path: pathOf(object, room.group), object, ...boxMeasure(frame, 'pin', object.name || undefined) });
    if (save) changed();
  }
  function togglePin(object: THREE.Object3D) {
    const index = pins.findIndex(p => p.object === object);
    if (index < 0) addPin(object);
    else { removeMeasure(pins[index]); pins.splice(index, 1); changed(); }
  }
  function showVolumes() {
    volumes.splice(0).forEach(removeMeasure);
    if (!volumesToggle.checked) return;
    for (const v of host.room()?.volumes ?? []) {
      volumes.push(boxMeasure({ min: new THREE.Vector3(...v.min), max: new THREE.Vector3(...v.max), matrix: new THREE.Matrix4() }, 'volume', v.label));
    }
  }
  volumesToggle.addEventListener('change', () => { showVolumes(); changed(); });

  function clearAll(save = true) {
    pins.splice(0).forEach(removeMeasure);
    tapes.splice(0).forEach(removeMeasure);
    cancelTape();
    if (save) changed();
  }
  panel.querySelector('#clear-measures')!.addEventListener('click', () => clearAll());

  // --- Panel list and URL state ---------------------------------------------------------------

  function renderList() {
    const items = [
      ...pins.map((p, i) => {
        const f = p.line.userData.frame as Frame;
        const s = f.max.clone().sub(f.min).multiply(new THREE.Vector3().setFromMatrixScale(f.matrix));
        return { kind: 'pin', text: p.object.name || p.path, detail: `${Math.round(s.x * 1000)} × ${Math.round(s.y * 1000)} × ${Math.round(s.z * 1000)} mm`, remove: () => { removeMeasure(p); pins.splice(i, 1); changed(); } };
      }),
      ...tapes.map((t, i) => {
        const d = t.b.clone().sub(t.a);
        return { kind: 'tape', text: `Tape ${mm(d.length())}`, detail: `Δx ${Math.round(Math.abs(d.x) * 1000)} · Δy ${Math.round(Math.abs(d.y) * 1000)} · Δz ${Math.round(Math.abs(d.z) * 1000)} mm`, remove: () => { removeMeasure(t); tapes.splice(i, 1); changed(); } };
      }),
    ];
    list.replaceChildren(...items.map(item => {
      const row = document.createElement('div');
      row.className = `measure-row ${item.kind}`;
      const text = document.createElement('span');
      text.innerHTML = '<b></b><small></small>';
      text.querySelector('b')!.textContent = item.text;
      text.querySelector('small')!.textContent = item.detail;
      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${item.text}`);
      remove.addEventListener('click', item.remove);
      row.append(text, remove);
      return row;
    }));
    list.hidden = !items.length;
    panel.querySelector<HTMLElement>('#clear-measures')!.hidden = !items.length;
  }
  const round = (v: THREE.Vector3) => v.toArray().map(n => Number(n.toFixed(4))).join(',');
  function writeURL() {
    const url = new URL(location.href);
    const set = (key: string, value: string) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    set('pins', pins.map(p => p.path).join('|'));
    set('tapes', tapes.map(t => `${round(t.a)},${round(t.b)}`).join(';'));
    set('volumes', volumesToggle.checked ? '' : '0');
    history.replaceState(null, '', url);
  }
  function changed() {
    renderList();
    writeURL();
    host.invalidate();
  }
  function readURL() {
    const room = host.room();
    if (!room) return;
    const q = new URLSearchParams(location.search);
    clearAll(false);
    volumesToggle.checked = q.get('volumes') !== '0';
    showVolumes();
    for (const path of (q.get('pins') ?? '').split('|').filter(Boolean)) {
      const object = resolvePath(path, room.group);
      if (object) addPin(object, false);
    }
    for (const encoded of (q.get('tapes') ?? '').split(';').filter(Boolean)) {
      const n = encoded.split(',').map(Number);
      if (n.length === 6 && n.every(v => Number.isFinite(v) && Math.abs(v) < 1000)) addTape(new THREE.Vector3(n[0], n[1], n[2]), new THREE.Vector3(n[3], n[4], n[5]), false);
    }
    renderList();
    host.invalidate();
  }

  // --- Pointer: hover picks a part, click sets the pivot / tape point, shift-click pins ---------

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerPx = { x: 0, y: 0 };
  let pickQueued = false;
  function hit(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(host.pickables(), false)[0];
  }
  function pick() {
    pickQueued = false;
    const room = host.room();
    if (!active || !room) return;
    const h = hit(pointerPx.x, pointerPx.y);
    const parts: THREE.Object3D[] = [];
    let inModel = false;
    for (let o: THREE.Object3D | null = h?.object ?? null; o; o = o.parent) {
      if (o === room.group) { inModel = true; break; }
      if (o.name || o === h!.object) parts.push(o);
    }
    // the hit mesh only stands for itself when it has a name or nothing above it does
    if (parts.length > 1 && !parts[0].name) parts.shift();
    const object = inModel && tool === 'pivot' ? parts[Math.min(level, parts.length - 1)] : undefined;
    const point = h?.point.clone();
    if (object !== hover.object) {
      removeMeasure(hoverMeasure);
      hoverMeasure = undefined;
      const frame = object && !pins.some(p => p.object === object) ? frameOf(object) : undefined;
      if (frame) hoverMeasure = boxMeasure(frame, 'hover');
    }
    hover = { object, point, parts: inModel ? parts : [] };
    showTooltip();
    if (tool === 'tape') {
      cursorDot.visible = !!point;
      if (point) cursorDot.position.copy(point);
      removeMeasure(rubber);
      rubber = tapeStart && point ? tapeMeasure(tapeStart, point, 0.6) : undefined;
    }
    host.invalidate();
  }
  function showTooltip() {
    const { object, parts } = hover;
    tooltip.hidden = !object && !(tool === 'tape' && hover.point);
    if (tooltip.hidden) return;
    if (tool === 'tape') {
      tooltip.textContent = tapeStart ? `${mm(tapeStart.distanceTo(hover.point!))} · click to finish` : 'Click the first point';
    } else {
      const index = parts.indexOf(object!);
      const chain = parts.slice(index).map(p => p.name || 'part').reverse().join(' › ');
      const pinned = pins.some(p => p.object === object);
      tooltip.textContent = `${chain}${index < parts.length - 1 ? '  ·  [ bigger' : ''}${index > 0 ? '  ·  ] smaller' : ''}  ·  shift-click to ${pinned ? 'unpin' : 'pin'}`;
    }
    const rect = canvas.getBoundingClientRect();
    tooltip.style.transform = `translate(${Math.min(pointerPx.x - rect.left + 14, rect.width - 260)}px, ${pointerPx.y - rect.top + 18}px)`;
  }
  function queuePick() {
    if (!pickQueued) { pickQueued = true; requestAnimationFrame(pick); }
  }
  let down: { x: number; y: number; time: number } | undefined;
  canvas.addEventListener('pointerdown', e => {
    if (!active) return;
    down = e.button === 0 ? { x: e.clientX, y: e.clientY, time: performance.now() } : undefined;
    host.requestFrame();
  });
  canvas.addEventListener('pointermove', e => {
    if (!active) return;
    pointerPx = { x: e.clientX, y: e.clientY };
    if (e.buttons) { host.requestFrame(); tooltip.hidden = true; }
    else queuePick();
  });
  canvas.addEventListener('pointerleave', () => { if (active) { tooltip.hidden = true; cursorDot.visible = false; host.invalidate(); } });
  canvas.addEventListener('wheel', () => { if (active) host.requestFrame(); }, { passive: true });
  canvas.addEventListener('pointerup', e => {
    if (!active || !down) return;
    const click = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && performance.now() - down.time < 500;
    down = undefined;
    if (!click) { queuePick(); return; }
    if (e.shiftKey && tool === 'pivot') {
      if (hover.object) { togglePin(hover.object); removeMeasure(hoverMeasure); hoverMeasure = undefined; hover.object = undefined; queuePick(); }
      return;
    }
    const h = hit(e.clientX, e.clientY);
    if (!h) return;
    if (tool === 'tape') {
      if (!tapeStart) tapeStart = h.point.clone();
      else { addTape(tapeStart, h.point); cancelTape(); }
      queuePick();
    } else host.pivot(h.point.clone());
  });

  function cancelTape() {
    tapeStart = undefined;
    removeMeasure(rubber);
    rubber = undefined;
  }
  function setTool(next: Tool) {
    tool = next;
    cancelTape();
    cursorDot.visible = false;
    panel.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === tool);
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    });
    canvas.classList.toggle('tape-tool', tool === 'tape');
    hover.object = undefined;
    removeMeasure(hoverMeasure);
    hoverMeasure = undefined;
    queuePick();
  }
  panel.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));
  window.addEventListener('keydown', e => {
    if (!active || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.matches('input, select, textarea')) return;
    if (e.code === 'KeyT') setTool(tool === 'tape' ? 'pivot' : 'tape');
    else if (e.code === 'BracketLeft') { level = Math.min(level + 1, Math.max(0, hover.parts.length - 1)); hover.object = undefined; queuePick(); }
    else if (e.code === 'BracketRight') { level = Math.max(0, level - 1); hover.object = undefined; queuePick(); }
    else if (e.code === 'Escape') { if (tapeStart) cancelTape(); else if (tool === 'tape') setTool('pivot'); level = 0; queuePick(); }
  });

  return {
    controls,
    get active() { return active; },
    /** dragging or gliding: the render loop keeps going while true */
    get busy() { return active && !!down; },
    enable(target: THREE.Vector3) {
      active = true;
      controls.target.copy(target);
      controls.enabled = true;
      layer.hidden = false;
      panel.hidden = false;
      host.invalidate();
    },
    disable() {
      active = false;
      controls.enabled = false;
      layer.hidden = tooltip.hidden = true;
      panel.hidden = true;
      host.invalidate();
    },
    /** after a room (re)build: same room keeps its pins (re-resolved by path), another one starts empty */
    setRoom(sameRoom: boolean) {
      if (!sameRoom) {
        const url = new URL(location.href);
        ['pins', 'tapes', 'volumes'].forEach(k => url.searchParams.delete(k));
        history.replaceState(null, '', url);
      }
      readURL();
    },
    /** project labels and draw the overlay on top of the finished frame */
    render(renderer: THREE.WebGLRenderer) {
      if (!active) return;
      const distance = camera.position.distanceTo(controls.target);
      pivotDot.position.copy(controls.target);
      pivotDot.scale.setScalar(Math.max(0.002, distance * 0.006));
      cursorDot.scale.setScalar(Math.max(0.002, camera.position.distanceTo(cursorDot.position) * 0.005));
      for (const m of [...pins, ...volumes]) placeBox(m);
      if (hoverMeasure) placeBox(hoverMeasure);
      for (const t of tapes) placeTape(t);
      if (rubber) placeTape(rubber);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(null);
      renderer.render(overlay, camera);
      renderer.autoClear = autoClear;
    },
  };
}
export type Inspector = ReturnType<typeof createInspector>;
