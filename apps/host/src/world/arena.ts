import * as THREE from 'three';
import { material, ringGeometry } from '../core/materials.js';
import type { Entity, PhysicsWorld } from '../core/physics.js';
import type { PlayerState } from '../game/roster.js';
import { buildPawn } from './pawn.js';

/**
 * Evenly spaced points on a circle. Slot 0 sits at -Z, the far side from the
 * camera, so the first player to join is never the one standing in front of
 * the on-screen scoreboard.
 */
export function ringPositions(count: number, radius: number): THREE.Vector3[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  });
}

/** A straight row centred on the origin. Used by the one-lane-each minigames. */
export function lanePositions(count: number, spacing: number): THREE.Vector3[] {
  const offset = ((count - 1) * spacing) / 2;
  return Array.from({ length: count }, (_, i) => new THREE.Vector3(i * spacing - offset, 0, 0));
}

/**
 * Camera distance that keeps `width` units of lane in frame with a margin.
 * Saves hand-tuning a camera per player count in every lane-based minigame.
 */
export function framingDistance(camera: THREE.PerspectiveCamera, width: number, margin = 1.25): number {
  const horizontalFov = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
  return (width * margin) / (2 * Math.tan(horizontalFov / 2));
}

export function plate(world: PhysicsWorld, radius: number, y: number, color: number): Entity {
  return world.spawn({
    kind: 'fixed',
    shape: { kind: 'cylinder', r: radius, hh: 0.4 },
    position: { x: 0, y: y - 0.4, z: 0 },
    color,
    friction: 0.9,
    restitution: 0.05,
    receiveShadow: true,
    castShadow: false,
    tag: 'ground',
  });
}

export function slab(
  world: PhysicsWorld,
  size: THREE.Vector3Like,
  position: THREE.Vector3Like,
  color: number,
  tag = 'ground',
): Entity {
  return world.spawn({
    kind: 'fixed',
    shape: { kind: 'box', hx: size.x / 2, hy: size.y / 2, hz: size.z / 2 },
    position,
    color,
    friction: 0.85,
    restitution: 0.05,
    castShadow: false,
    tag,
  });
}

/** Invisible bumpers so a stray body cannot leave the playfield sideways. */
export function bumpers(world: PhysicsWorld, halfX: number, halfZ: number, height = 4): void {
  const t = 0.5;
  const walls: [THREE.Vector3Like, THREE.Vector3Like][] = [
    [{ x: halfX + t, y: height / 2, z: 0 }, { x: t, y: height, z: halfZ * 2 }],
    [{ x: -halfX - t, y: height / 2, z: 0 }, { x: t, y: height, z: halfZ * 2 }],
    [{ x: 0, y: height / 2, z: halfZ + t }, { x: halfX * 2, y: height, z: t }],
    [{ x: 0, y: height / 2, z: -halfZ - t }, { x: halfX * 2, y: height, z: t }],
  ];
  for (const [position, size] of walls) {
    world.spawn({
      kind: 'fixed',
      shape: { kind: 'box', hx: size.x / 2, hy: size.y / 2, hz: size.z / 2 },
      position,
      visible: false,
      friction: 0.2,
      restitution: 0.3,
      tag: 'wall',
    });
  }
}

export interface PawnBodyOptions {
  radius?: number;
  height?: number;
  density?: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
}

/**
 * A player's physical presence: an upright capsule-ish cylinder with the
 * player's board-game pawn as its visual. Rotation is locked so the token
 * always reads right way up, which matters more than physical realism here.
 */
export function spawnPawnBody(
  world: PhysicsWorld,
  player: PlayerState,
  position: THREE.Vector3Like,
  options: PawnBodyOptions = {},
): Entity {
  const radius = options.radius ?? 0.42;
  const height = options.height ?? 1.0;
  const pawn = buildPawn(player.identity.shape, player.identity.color, height);
  // The body's origin is its centre; the pawn model stands on its own base.
  pawn.position.y = -height / 2;
  const holder = new THREE.Group();
  holder.add(pawn);

  return world.spawn({
    kind: 'dynamic',
    shape: { kind: 'cylinder', r: radius, hh: height / 2 },
    position: { x: position.x, y: position.y + height / 2, z: position.z },
    mesh: holder,
    density: options.density ?? 1.4,
    friction: options.friction ?? 0.55,
    restitution: options.restitution ?? 0.45,
    linearDamping: options.linearDamping ?? 0.55,
    lockRotation: true,
    tag: 'player:' + player.identity.id,
  });
}

/** Glowing ring used to mark targets, danger zones and shrinking plates. */
export function marker(
  color: THREE.ColorRepresentation,
  radius: number,
  thickness = Math.max(0.06, radius * 0.022),
): THREE.Mesh {
  const ring = new THREE.Mesh(
    ringGeometry(radius, thickness),
    material(color, { emissive: color, emissiveIntensity: 1.4, roughness: 0.4 }),
  );
  ring.rotation.x = Math.PI / 2;
  return ring;
}

/** Reads the player id back out of an entity tag written by spawnPawnBody. */
export function playerIdFromTag(tag: string): string | null {
  return tag.startsWith('player:') ? tag.slice('player:'.length) : null;
}
