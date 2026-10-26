import * as THREE from 'three';
import scan from '../../data/demos/__ROOM__/scan.json';
import type { materials } from '../../packages/room-runtime/materials';
import { buildWall, type WallDef } from '../../packages/room-runtime/walls';
import { HEIGHT } from './dims';

/**
 * Architecture, surfaces and light: walls, floor, skirting, ceiling, openings, global lights,
 * exposure and tone mapping. Baseline values; the shell area calibrates them against the photos.
 */
const polygon = scan.polygon as [number, number][];

function slab(y: number, material: THREE.Material) {
  const shape = new THREE.Shape(polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), material);
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

export function shell(m: ReturnType<typeof materials>) {
  const paint = m.wall.clone();
  const ceilingPaint = Object.assign(m.ceiling.clone(), { side: THREE.BackSide });
  const floor = slab(0, new THREE.MeshStandardMaterial({ color: '#cfc6b4', roughness: 0.5 }));
  const ceiling = new THREE.Group();
  ceiling.add(slab(HEIGHT, ceilingPaint));

  const walls = scan.walls.map((w) => {
    const def: WallDef = {
      name: String(w.index),
      origin: new THREE.Vector3(...(w.origin as [number, number, number])),
      u: new THREE.Vector3(...(w.u as [number, number, number])),
      n: new THREE.Vector3(...(w.n as [number, number, number])),
      length: w.length,
      thickness: 0.12,
      height: HEIGHT,
      crown: false,
      panels: [],
      material: paint,
      trimMaterial: paint,
      openings: w.openings.map((o) => ({ kind: 'rect' as const, u0: o.u0, u1: o.u1, v0: o.v0, v1: Math.min(o.v1, HEIGHT - 0.02), casing: false })),
    };
    return { def, group: buildWall(def, m) };
  });

  const lights = new THREE.Group();
  lights.add(new THREE.HemisphereLight('#f2f0ea', '#b8ad98', 1.1));
  const key = new THREE.DirectionalLight('#fff6e8', 1.4);
  key.position.set(2, HEIGHT + 2, 1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 12 });
  lights.add(key);

  return { floor, ceiling, walls, lights, exposure: 1.0, render: { toneMapping: THREE.NeutralToneMapping } };
}
