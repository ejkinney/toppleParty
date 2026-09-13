import * as THREE from 'three';

/**
 * Every shape in the game is a primitive, so one geometry per primitive is
 * shared by every mesh and instances differ only by scale. Same for materials,
 * keyed by colour. This keeps a 200-block scene at a handful of GPU uploads.
 */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_BALL = new THREE.SphereGeometry(0.5, 20, 14);
const UNIT_CYLINDER = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
const UNIT_CONE = new THREE.ConeGeometry(0.5, 1, 20);
const UNIT_TORUS = new THREE.TorusGeometry(0.4, 0.12, 10, 24);

/**
 * Rings are the one primitive that cannot be produced by scaling: scaling a
 * torus uniformly scales its tube too, so a 7-unit arena ring built that way
 * comes out as a 2-unit-thick doughnut. Each radius gets real geometry,
 * cached because a session only ever asks for a handful.
 */
const rings = new Map<string, THREE.TorusGeometry>();

export function ringGeometry(radius: number, thickness = 0.09): THREE.TorusGeometry {
  const key = radius.toFixed(3) + ':' + thickness.toFixed(3);
  let geometry = rings.get(key);
  if (!geometry) {
    geometry = shareGeometry(new THREE.TorusGeometry(radius, thickness, 10, 64));
    rings.set(key, geometry);
  }
  return geometry;
}

export const GEOMETRY = {
  box: UNIT_BOX,
  ball: UNIT_BALL,
  cylinder: UNIT_CYLINDER,
  cone: UNIT_CONE,
  torus: UNIT_TORUS,
} as const;

export type GeometryKind = keyof typeof GEOMETRY;

/**
 * Geometries that outlive the scene using them.
 *
 * disposeObject() frees anything a scene built for itself, but module-level
 * caches (the unit primitives here, the pawn parts in world/pawn.ts) are shared
 * by every later scene. Anything registered here is left alone; forgetting to
 * register a cached geometry means the second scene to use it renders from a
 * geometry the first one already disposed.
 */
const shared = new Set<THREE.BufferGeometry>(Object.values(GEOMETRY));

export function shareGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
  shared.add(geometry);
  return geometry;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();

export interface MaterialOptions {
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}

export function material(color: THREE.ColorRepresentation, options: MaterialOptions = {}): THREE.MeshStandardMaterial {
  const key = [
    new THREE.Color(color).getHexString(),
    options.roughness ?? 0.62,
    options.metalness ?? 0.04,
    options.emissive ? new THREE.Color(options.emissive).getHexString() : '-',
    options.emissiveIntensity ?? 1,
    options.opacity ?? 1,
  ].join('|');

  let cached = materials.get(key);
  if (!cached) {
    cached = new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.62,
      metalness: options.metalness ?? 0.04,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 1,
      transparent: options.transparent ?? (options.opacity ?? 1) < 1,
      opacity: options.opacity ?? 1,
    });
    materials.set(key, cached);
  }
  return cached;
}

/** Slightly darker or lighter sibling of a seat colour, for trim and accents. */
export function shade(color: THREE.ColorRepresentation, amount: number): THREE.Color {
  const base = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  return base.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + amount, 0, 1));
}

/** Frees only what is not shared. Shared caches live for the page's lifetime. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!shared.has(mesh.geometry)) mesh.geometry.dispose();
  });
  root.removeFromParent();
}
