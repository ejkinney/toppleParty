import * as THREE from 'three';
import { SNAPSHOT_STRIDE, TOWER, pristineSnapshot, type TowerSnapshot } from '@topple/shared';
import { GEOMETRY, material, shade } from '../core/materials.js';

/**
 * Renders a tower from transforms a phone sent us.
 *
 * There is no physics here on purpose: the phone owns its own simulation and
 * this is a puppet of it. That keeps eight simultaneous towers free on the TV
 * and means the phone and the TV can never disagree about what happened.
 *
 * Meshes are keyed by the block id inside the snapshot, so a pulled block
 * disappears from the mirror the moment it leaves the phone's tower.
 */
export class TowerMirror {
  readonly group = new THREE.Group();
  private readonly blocks = new Map<number, THREE.Mesh>();
  private readonly seen = new Set<number>();
  private readonly bodyMaterial: THREE.Material;
  private readonly altMaterial: THREE.Material;

  constructor(
    color: THREE.ColorRepresentation,
    /** Towers are simulated at real Jenga scale; the board wants them bigger. */
    private readonly scale = 9,
  ) {
    const base = new THREE.Color(color);
    this.bodyMaterial = material(shade(base, 0.12), { roughness: 0.75, metalness: 0.02 });
    this.altMaterial = material(shade(base, -0.08), { roughness: 0.75, metalness: 0.02 });
  }

  get blockCount(): number {
    return this.blocks.size;
  }

  /** Height of the highest block, in mirror units. Drives the camera framing. */
  get topY(): number {
    let top = 0;
    for (const mesh of this.blocks.values()) top = Math.max(top, mesh.position.y);
    return top;
  }

  apply(snapshot: TowerSnapshot): void {
    this.seen.clear();
    const count = Math.floor(snapshot.length / SNAPSHOT_STRIDE);

    for (let i = 0; i < count; i++) {
      const offset = i * SNAPSHOT_STRIDE;
      const id = snapshot[offset] ?? 0;
      this.seen.add(id);

      let mesh = this.blocks.get(id);
      if (!mesh) {
        mesh = new THREE.Mesh(GEOMETRY.box, id % 2 === 0 ? this.bodyMaterial : this.altMaterial);
        mesh.scale.set(
          TOWER.BLOCK_LENGTH * this.scale,
          TOWER.BLOCK_HEIGHT * this.scale,
          TOWER.BLOCK_WIDTH * this.scale,
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.blocks.set(id, mesh);
        this.group.add(mesh);
      }

      mesh.position.set(
        (snapshot[offset + 1] ?? 0) * this.scale,
        (snapshot[offset + 2] ?? 0) * this.scale,
        (snapshot[offset + 3] ?? 0) * this.scale,
      );
      mesh.quaternion.set(
        snapshot[offset + 4] ?? 0,
        snapshot[offset + 5] ?? 0,
        snapshot[offset + 6] ?? 0,
        snapshot[offset + 7] ?? 1,
      );
    }

    for (const [id, mesh] of this.blocks) {
      if (this.seen.has(id)) continue;
      this.group.remove(mesh);
      this.blocks.delete(id);
    }
  }

  /**
   * Builds a pristine tower locally, for players who have not pulled yet.
   * Shares pristineSnapshot with the phone, so the TV's idea of a fresh tower
   * is identical to the one being simulated.
   */
  applyPristine(blockCount: number): void {
    this.apply(pristineSnapshot(blockCount));
  }

  dispose(): void {
    this.blocks.clear();
    this.group.clear();
    this.group.removeFromParent();
  }
}
