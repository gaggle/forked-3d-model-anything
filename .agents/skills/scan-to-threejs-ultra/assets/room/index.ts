import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import scan from '../../data/demos/__ROOM__/scan.json';
import { loadTextures, materials } from '../../packages/room-runtime/materials';
import type { BuiltRoom, RoomModule } from '../../packages/room-runtime/types';
import type { Area, Part } from './part';
import { shell } from './shell';

/**
 * __LABEL__: House Capture session room, rebuilt by area. Walls/openings from RoomPlan; positions
 * and heights from the LiDAR mesh and fused depth; construction, materials and small items from the
 * posed photos. Every `areas/<key>.ts` is loaded on its own, so one broken area never blanks the
 * room. `?areas=a,b` renders only those areas, `?hideAreas=a` leaves them out (A/B and isolation).
 */
const AREAS = import.meta.glob<{ default: Area }>('./areas/*.ts');
const polygon = scan.polygon as [number, number][];

function insideRoom(x: number, z: number) {
  let hit = false;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i], [x2, z2] = polygon[(i + 1) % polygon.length];
    if (z1 > z !== z2 > z && x < x1 + ((z - z1) * (x2 - x1)) / (z2 - z1)) hit = !hit;
  }
  return hit;
}

/** the LiDAR mesh in room coordinates, colored by the in-app photo bake where it has one */
async function loadScan(onProgress?: (p: number) => void) {
  const [geo, colors] = await Promise.all([
    new PLYLoader().loadAsync('/__ROOM__/scan/room.ply', (e) => e.total && onProgress?.(e.loaded / e.total)),
    fetch('/__ROOM__/scan/room-colors.bin').then((r) => (r.ok ? r.arrayBuffer() : null)),
  ]);
  const color = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (colors && color && colors.byteLength === color.count * 3) {
    const baked = new Uint8Array(colors);
    for (let i = 0; i < color.count; i++) {
      const [r, g, b] = [baked[i * 3], baked[i * 3 + 1], baked[i * 3 + 2]];
      if (r || g || b) color.setXYZ(i, r / 255, g / 255, b / 255);
    }
  }
  geo.applyMatrix4(new THREE.Matrix4().fromArray(scan.transform.worldToRoom));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: !!color, side: THREE.DoubleSide }));
}

async function loadAreas(): Promise<Part[]> {
  const q = new URLSearchParams(location.search);
  const only = q.get('areas')?.split(','), hide = q.get('hideAreas')?.split(',') ?? [];
  const entries = Object.entries(AREAS).map(([path, load]) => [path.replace(/^.*\/|\.ts$/g, ''), load] as const)
    .filter(([key]) => (!only || only.includes(key)) && !hide.includes(key));
  return Promise.all(entries.map(async ([key, load]) => {
    try {
      return await (await load()).default();
    } catch (e) {
      console.error(`area ${key} failed`, e);
      return {};
    }
  }));
}

async function build(): Promise<BuiltRoom> {
  await loadTextures();
  const group = new THREE.Group();
  group.name = '__ROOM__';
  const s = shell(materials());
  group.add(s.floor, s.ceiling, ...s.walls.map((w) => w.group));

  for (const p of await loadAreas()) {
    if (p.room?.length) group.add(...p.room);
    if (p.ceiling?.length) s.ceiling.add(...p.ceiling);
    if (p.lights?.length) s.lights.add(...p.lights);
    for (const [i, objs] of Object.entries(p.walls ?? {})) if (objs?.length) s.walls[Number(i)].group.add(...objs);
  }

  const [minX, minZ] = polygon.reduce(([a, b], [x, z]) => [Math.min(a, x), Math.min(b, z)], [Infinity, Infinity]);
  const [maxX, maxZ] = polygon.reduce(([a, b], [x, z]) => [Math.max(a, x), Math.max(b, z)], [-Infinity, -Infinity]);
  return {
    layout: scan,
    group,
    lights: s.lights,
    walls: s.walls,
    ceiling: [s.ceiling],
    wallTop: s.walls[0].def.height!,
    exposure: s.exposure,
    render: s.render,
    walkable: (x, z) => insideRoom(x, z) && insideRoom(x + 0.2, z) && insideRoom(x - 0.2, z) && insideRoom(x, z + 0.2) && insideRoom(x, z - 0.2),
    camera: {
      orbit: [maxX + 1, 4.3, maxZ + 2], target: [(minX + maxX) / 2, 0.7, (minZ + maxZ) / 2],
      walk: [(minX + maxX) / 2, 1.6, (minZ + maxZ) / 2], walkLook: [minX, 1.0, (minZ + maxZ) / 2],
    },
    environment: { center: [(minX + maxX) / 2, 1.3, (minZ + maxZ) / 2], intensity: 1 },
    loadReference: loadScan,
    referenceAvailable: true,
    referenceKind: 'scan',
    photos: scan.photos.map((p, i) => ({
      url: `/__ROOM__/photos/${String(i).padStart(4, '0')}.jpg`,
      position: p.position, forward: p.forward, up: p.up, fovY: p.fovY, aspect: p.aspect,
    })),
  };
}

export const __EXPORT__: RoomModule = { id: '__ROOM__', label: '__LABEL__', build };
