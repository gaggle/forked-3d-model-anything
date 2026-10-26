import * as THREE from 'three';
import scan from '../../data/demos/__ROOM__/scan.json';

/** a RoomPlan object box (scan.json objects[index]) as a stand-in until the area is modeled */
export function placeholder(index: number, color = '#b0a898') {
  const o = scan.objects[index];
  const m = new THREE.Mesh(new THREE.BoxGeometry(...(o.size as [number, number, number])), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.set(...(o.center as [number, number, number]));
  m.rotation.y = o.rotY;
  m.castShadow = m.receiveShadow = true;
  m.name = `placeholder:${o.category}`;
  return m;
}
