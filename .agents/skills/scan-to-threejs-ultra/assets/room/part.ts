import type * as THREE from 'three';

/**
 * What each area module (areas/<key>.ts, default export) returns. `room`: free-standing objects in
 * room coordinates. `walls[i]`: objects mounted on wall i (room coordinates), hidden with it in the
 * dollhouse cutaway. `ceiling`: hidden when the camera is above the ceiling. `lights`: light sources.
 *
 * Separable things (the final separation pass): the top-level Object3D of each standalone item
 * carries `userData.item` (see ItemTag) and `userData.physics` (packages/room-physics/tagging.ts).
 */
export interface Part {
  room?: THREE.Object3D[];
  walls?: Partial<Record<number, THREE.Object3D[]>>;
  ceiling?: THREE.Object3D[];
  lights?: THREE.Object3D[];
}

export interface ItemTag {
  /** unique within the room, kebab-case: 'desk', 'desk/pencil-03' */
  id: string;
  label: string;
  /** id of the item it rests on or hangs from ('floor', 'wall-2', or another item id) */
  restsOn: string;
  /** how sure we are that it is a separate physical object: 'high' only when photos show it free */
  confidence: 'high' | 'medium' | 'low';
  /** photo numbers that show it best */
  photos?: number[];
}

export type Area = () => Promise<Part>;
