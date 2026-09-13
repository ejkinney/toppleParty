import { BALANCE } from './balance.js';

/**
 * Tower geometry. The phone simulates with these numbers and the TV mirrors
 * with the same ones, so a snapshot only has to carry transforms - never sizes.
 * Units are metres; the tower is scaled up at render time.
 */
export const TOWER = {
  BLOCK_LENGTH: 0.075,
  BLOCK_WIDTH: 0.025,
  BLOCK_HEIGHT: 0.015,
  /** Gap baked into each slot so a fresh tower is not interpenetrating. */
  SLOT_GAP: 0.0006,
  LEVELS: BALANCE.TOWER_LEVELS,
  PER_LEVEL: BALANCE.TOWER_PER_LEVEL,
} as const;

export const TOTAL_BLOCKS = TOWER.LEVELS * TOWER.PER_LEVEL;
export const TOWER_HEIGHT = TOWER.LEVELS * TOWER.BLOCK_HEIGHT;

/**
 * Flat transform stream: 8 numbers per block - id, x, y, z, qx, qy, qz, qw.
 * A packed array beats an array of objects by roughly 4x on the wire and
 * avoids allocating 27 objects per frame on a phone.
 */
export type TowerSnapshot = number[];
export const SNAPSHOT_STRIDE = 8;

export function snapshotBlockCount(snap: TowerSnapshot): number {
  return Math.floor(snap.length / SNAPSHOT_STRIDE);
}

/** The rest position of a block in a pristine tower. Pure function of index. */
export function slotTransform(index: number): {
  x: number;
  y: number;
  z: number;
  rotated: boolean;
} {
  const level = Math.floor(index / TOWER.PER_LEVEL);
  const withinLevel = index % TOWER.PER_LEVEL;
  const rotated = level % 2 === 1;
  const pitch = TOWER.BLOCK_WIDTH + TOWER.SLOT_GAP;
  const offset = (withinLevel - (TOWER.PER_LEVEL - 1) / 2) * pitch;
  const y = TOWER.BLOCK_HEIGHT * (level + 0.5);
  return rotated ? { x: offset, y, z: 0, rotated } : { x: 0, y, z: offset, rotated };
}
