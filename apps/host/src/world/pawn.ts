import * as THREE from 'three';
import type { TokenShape } from '@topple/shared';
import { GEOMETRY, material, shade } from '../core/materials.js';

/**
 * Board-game pawns built entirely from primitives - no meshes, no textures,
 * no loading screen. Each token is roughly 1 unit tall and stands on the
 * origin, so a pawn can be dropped straight onto a physics body.
 *
 * Bespoke geometries (tapered cones, wheels) are created once and cached; the
 * rest reuses the shared unit primitives.
 */
const bespoke = new Map<string, THREE.BufferGeometry>();

function taper(key: string, top: number, bottom: number, height: number): THREE.BufferGeometry {
  let geometry = bespoke.get(key);
  if (!geometry) {
    geometry = new THREE.CylinderGeometry(top, bottom, height, 18);
    bespoke.set(key, geometry);
  }
  return geometry;
}

interface PartOptions {
  geometry?: THREE.BufferGeometry;
  color: THREE.ColorRepresentation;
  position?: [number, number, number];
  scale?: [number, number, number];
  rotation?: [number, number, number];
  metalness?: number;
  roughness?: number;
}

function part(options: PartOptions): THREE.Mesh {
  const mesh = new THREE.Mesh(
    options.geometry ?? GEOMETRY.box,
    material(options.color, {
      metalness: options.metalness ?? 0.35,
      roughness: options.roughness ?? 0.45,
    }),
  );
  if (options.position) mesh.position.set(...options.position);
  if (options.scale) mesh.scale.set(...options.scale);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Builds a pawn of the given shape in the given seat colour.
 * `height` scales the whole token; the default is 1 unit tall.
 */
export function buildPawn(shape: TokenShape, color: THREE.ColorRepresentation, height = 1): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Color(color);
  const trim = shade(color, -0.22);
  const light = shade(color, 0.18);

  // Every token shares a plinth so they read as one set from across a room.
  group.add(
    part({ geometry: GEOMETRY.cylinder, color: trim, position: [0, 0.05, 0], scale: [0.78, 0.1, 0.78] }),
  );

  switch (shape) {
    case 'tophat':
      group.add(part({ geometry: GEOMETRY.cylinder, color: body, position: [0, 0.13, 0], scale: [0.86, 0.06, 0.86] }));
      group.add(part({ geometry: GEOMETRY.cylinder, color: body, position: [0, 0.45, 0], scale: [0.5, 0.62, 0.5] }));
      // The band hugs the crown (r 0.26), so it must sit inside the brim (r 0.43).
      group.add(part({ geometry: GEOMETRY.torus, color: light, position: [0, 0.3, 0], scale: [0.62, 0.62, 0.62], rotation: [Math.PI / 2, 0, 0] }));
      break;

    case 'boot':
      group.add(part({ color: body, position: [0, 0.16, 0.06], scale: [0.42, 0.16, 0.76] }));
      group.add(part({ color: body, position: [0, 0.5, -0.12], scale: [0.4, 0.56, 0.4] }));
      group.add(part({ color: trim, position: [0, 0.1, 0.06], scale: [0.48, 0.08, 0.84] }));
      group.add(part({ color: light, position: [0, 0.76, -0.12], scale: [0.44, 0.1, 0.44] }));
      break;

    case 'racecar': {
      group.add(part({ color: body, position: [0, 0.26, 0], scale: [0.46, 0.18, 0.94] }));
      group.add(part({ color: light, position: [0, 0.42, -0.08], scale: [0.36, 0.18, 0.4] }));
      group.add(part({ color: trim, position: [0, 0.3, 0.5], scale: [0.3, 0.1, 0.16] }));
      const wheel = taper('wheel', 0.13, 0.13, 0.09);
      for (const [x, z] of [[-0.27, 0.3], [0.27, 0.3], [-0.27, -0.3], [0.27, -0.3]] as const) {
        group.add(part({ geometry: wheel, color: 0x191b26, position: [x, 0.18, z], rotation: [0, 0, Math.PI / 2], metalness: 0.1, roughness: 0.8 }));
      }
      break;
    }

    case 'thimble':
      group.add(part({ geometry: taper('thimble', 0.34, 0.44, 0.72), color: body, position: [0, 0.46, 0] }));
      group.add(part({ geometry: GEOMETRY.ball, color: light, position: [0, 0.82, 0], scale: [0.62, 0.3, 0.62] }));
      break;

    case 'dog':
      group.add(part({ color: body, position: [0, 0.4, 0], scale: [0.34, 0.3, 0.8] }));
      group.add(part({ color: body, position: [0, 0.58, 0.42], scale: [0.3, 0.3, 0.3] }));
      group.add(part({ color: light, position: [0, 0.5, 0.58], scale: [0.18, 0.14, 0.18] }));
      group.add(part({ color: trim, position: [0, 0.62, -0.42], scale: [0.1, 0.34, 0.1], rotation: [0.5, 0, 0] }));
      for (const [x, z] of [[-0.14, 0.26], [0.14, 0.26], [-0.14, -0.26], [0.14, -0.26]] as const) {
        group.add(part({ color: trim, position: [x, 0.2, z], scale: [0.12, 0.32, 0.12] }));
      }
      break;

    case 'battleship':
      group.add(part({ color: body, position: [0, 0.22, 0], scale: [0.44, 0.2, 1.0] }));
      group.add(part({ color: light, position: [0, 0.4, -0.06], scale: [0.34, 0.18, 0.5] }));
      group.add(part({ geometry: GEOMETRY.cylinder, color: trim, position: [0, 0.62, -0.1], scale: [0.16, 0.3, 0.16] }));
      group.add(part({ geometry: GEOMETRY.cone, color: light, position: [0, 0.3, 0.56], scale: [0.36, 0.34, 0.36], rotation: [Math.PI / 2, 0, 0] }));
      break;

    case 'wheelbarrow': {
      group.add(part({ color: body, position: [0, 0.36, -0.04], scale: [0.5, 0.26, 0.62] }));
      group.add(part({ geometry: taper('barrowWheel', 0.2, 0.2, 0.1), color: 0x191b26, position: [0, 0.2, 0.42], rotation: [0, 0, Math.PI / 2], metalness: 0.1, roughness: 0.8 }));
      for (const x of [-0.2, 0.2]) {
        group.add(part({ color: trim, position: [x, 0.28, -0.42], scale: [0.07, 0.07, 0.5] }));
      }
      break;
    }

    case 'iron':
      group.add(part({ color: body, position: [0, 0.2, 0], scale: [0.5, 0.16, 0.86] }));
      group.add(part({ geometry: GEOMETRY.cone, color: body, position: [0, 0.2, 0.52], scale: [0.5, 0.4, 0.5], rotation: [Math.PI / 2, 0, 0] }));
      group.add(part({ geometry: GEOMETRY.torus, color: light, position: [0, 0.52, -0.02], scale: [1.0, 1.0, 0.6], rotation: [0, Math.PI / 2, 0] }));
      break;
  }

  group.scale.setScalar(height);
  group.userData['seatColor'] = body.getHex();
  return group;
}

/** Flat coloured disc used as a pawn's home marker on the meetup board. */
export function buildPad(color: THREE.ColorRepresentation, radius = 0.8): THREE.Mesh {
  const pad = new THREE.Mesh(
    GEOMETRY.cylinder,
    material(color, { roughness: 0.9, metalness: 0, emissive: color, emissiveIntensity: 0.22 }),
  );
  pad.scale.set(radius * 2, 0.04, radius * 2);
  pad.receiveShadow = true;
  return pad;
}
