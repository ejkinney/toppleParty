import * as THREE from 'three';
import { Btn, MINIGAMES, clampDisc, deadzone, held, type PlayerId } from '@topple/shared';
import type { Minigame, MinigameContext, MinigameFactory } from './types.js';
import type { Entity } from '../core/physics.js';
import { bumpers, playerIdFromTag, ringPositions, slab, spawnPawnBody } from '../world/arena.js';

const ARENA_HALF = 8;
const MOVE_FORCE = 42;
const MAX_SPEED = 8.5;
const JUMP_IMPULSE = 7.4;
const JUMP_COOLDOWN = 0.35;

const SPAWN_START = 0.62;
const SPAWN_FLOOR = 0.16;
/** Seconds of round over which the rain reaches full intensity. */
const RAMP_UP = 32;
/** A hit only counts if the block was actually falling, not just resting. */
const LETHAL_SPEED = 6.5;
/** Above this many settled blocks the oldest are recycled. */
const DEBRIS_BUDGET = 70;

const PALETTE = [0x8aa0c8, 0x6f7fb0, 0xa8b6d8, 0x5d6b98];

interface Runner {
  id: PlayerId;
  body: Entity;
  jumpCooldown: number;
}

interface Falling {
  entity: Entity;
  age: number;
  settledFor: number;
}

/**
 * Debris Dodge - the only shared-arena survival game. Blocks rain faster and
 * faster and pile into cover you can hide behind, so the floor the players are
 * fighting over is built out of the hazard itself.
 */
class DebrisDodge implements Minigame {
  private readonly runners = new Map<PlayerId, Runner>();
  private readonly fallen: { id: PlayerId; at: number }[] = [];
  private readonly debris: Falling[] = [];
  private spawnTimer = 1.2;

  constructor(private readonly ctx: MinigameContext) {}

  build(): void {
    slab(this.ctx.physics, { x: ARENA_HALF * 2, y: 1, z: ARENA_HALF * 2 }, { x: 0, y: -0.5, z: 0 }, 0x1d2a4d);
    bumpers(this.ctx.physics, ARENA_HALF, ARENA_HALF, 9);

    const spawns = ringPositions(this.ctx.players.length, ARENA_HALF * 0.55);
    for (const [index, player] of this.ctx.players.entries()) {
      const at = spawns[index] as THREE.Vector3;
      const body = spawnPawnBody(this.ctx.physics, player, at, { restitution: 0.1, linearDamping: 0.9 });
      this.runners.set(player.identity.id, { id: player.identity.id, body, jumpCooldown: 0 });
    }

    // A falling block only kills while it is still falling; contact events give
    // us the exact moment of impact, which polling positions would miss.
    this.ctx.physics.contacts((a, b, started) => {
      if (!started) return;
      const pair = this.asHit(a, b) ?? this.asHit(b, a);
      if (!pair) return;
      const velocity = pair.block.linvel;
      if (Math.abs(velocity.y) < LETHAL_SPEED) return;
      this.knockOut(pair.victim);
    });

    this.ctx.stage.look({ x: 0, y: 15, z: 15 }, { x: 0, y: 1, z: 0 }, true, 3);
  }

  private asHit(a: Entity, b: Entity): { block: Entity; victim: PlayerId } | null {
    const victim = playerIdFromTag(b.tag);
    if (!victim || a.tag !== 'debris') return null;
    return { block: a, victim };
  }

  fixedUpdate(dt: number): void {
    for (const { player, action } of this.ctx.input.drain()) {
      if (action.a !== 'jump') continue;
      const runner = this.runners.get(player);
      if (!runner || runner.jumpCooldown > 0) continue;
      // Grounded enough: near the floor or a pile, and not already rising.
      const velocity = runner.body.linvel;
      if (runner.body.position.y > 3.2 || velocity.y > 2.5) continue;
      runner.body.impulse(0, JUMP_IMPULSE, 0);
      runner.jumpCooldown = JUMP_COOLDOWN;
    }

    for (const runner of this.runners.values()) {
      runner.jumpCooldown = Math.max(0, runner.jumpCooldown - dt);
      const frame = this.ctx.input.frame(runner.id);
      const aim = clampDisc(deadzone(frame.x ?? 0), deadzone(frame.y ?? 0));
      const velocity = runner.body.linvel;
      const speed = Math.hypot(velocity.x, velocity.z);
      const authority = speed > MAX_SPEED ? 0.1 : 1;
      runner.body.force(aim.x * MOVE_FORCE * authority, 0, -aim.y * MOVE_FORCE * authority);
      if (held(frame, Btn.A) && runner.jumpCooldown <= 0 && runner.body.position.y < 3.2 && velocity.y <= 2.5) {
        runner.body.impulse(0, JUMP_IMPULSE, 0);
        runner.jumpCooldown = JUMP_COOLDOWN;
      }
    }

    this.rain(dt);
    this.recycle(dt);
  }

  private rain(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    const intensity = Math.min(1, this.ctx.elapsed / RAMP_UP);
    this.spawnTimer = SPAWN_START - (SPAWN_START - SPAWN_FLOOR) * intensity;

    const size = 0.5 + this.ctx.rng() * 0.55;
    const x = (this.ctx.rng() * 2 - 1) * (ARENA_HALF - 1);
    const z = (this.ctx.rng() * 2 - 1) * (ARENA_HALF - 1);
    const color = PALETTE[Math.floor(this.ctx.rng() * PALETTE.length)] as number;

    const block = this.ctx.physics.spawn({
      shape: { kind: 'box', hx: size / 2, hy: size / 2, hz: size / 2 },
      position: { x, y: 14, z },
      rotation: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(this.ctx.rng() * 3, this.ctx.rng() * 3, this.ctx.rng() * 3),
      ),
      color,
      density: 1.3,
      friction: 0.8,
      restitution: 0.08,
      ccd: true,
      tag: 'debris',
    });
    this.debris.push({ entity: block, age: 0, settledFor: 0 });
  }

  /**
   * Blocks are never deleted while they matter, but a pile that has been
   * motionless for a while is scenery. Recycling the oldest keeps the step
   * cost flat no matter how long the round runs.
   */
  private recycle(dt: number): void {
    for (const piece of this.debris) {
      piece.age += dt;
      const velocity = piece.entity.linvel;
      const moving = Math.hypot(velocity.x, velocity.y, velocity.z) > 0.3;
      piece.settledFor = moving ? 0 : piece.settledFor + dt;
    }

    while (this.debris.length > DEBRIS_BUDGET) {
      const index = this.debris.findIndex((piece) => piece.settledFor > 2.5);
      if (index < 0) break;
      const piece = this.debris[index] as Falling;
      this.ctx.physics.remove(piece.entity);
      this.debris.splice(index, 1);
    }
  }

  private knockOut(id: PlayerId): void {
    const runner = this.runners.get(id);
    if (!runner) return;
    this.runners.delete(id);
    this.fallen.push({ id, at: this.ctx.elapsed });
    this.ctx.physics.remove(runner.body);
    this.ctx.impact(0.5, [id]);
  }

  rank(): PlayerId[] {
    const survivors = [...this.runners.keys()];
    // Last knocked out is the best of the losers, so the graveyard reverses.
    return [...survivors, ...this.fallen.map((entry) => entry.id).reverse()];
  }

  isOver(): boolean {
    return this.runners.size <= 1;
  }

  scoreLine(player: PlayerId): string {
    if (this.runners.has(player)) return 'survived the whole storm';
    const entry = this.fallen.find((record) => record.id === player);
    return entry ? 'squashed at ' + entry.at.toFixed(1) + 's' : '';
  }

  banner(): string {
    return this.debris.length + ' blocks on the floor';
  }
}

export const debrisFactory: MinigameFactory = {
  meta: MINIGAMES.debris,
  create: (ctx) => new DebrisDodge(ctx),
};
