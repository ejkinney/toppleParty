import * as THREE from 'three';
import { Btn, MINIGAMES, clampDisc, deadzone, held, type PlayerId } from '@topple/shared';
import type { Minigame, MinigameContext, MinigameFactory } from './types.js';
import type { Entity } from '../core/physics.js';
import { marker, plate, playerIdFromTag, ringPositions, spawnPawnBody } from '../world/arena.js';

const PLATE_START = 7.4;
const PLATE_FLOOR = 3.2;
const SHRINK_EVERY = 9;
const SHRINK_BY = 1.1;

const MOVE_FORCE = 34;
const MAX_SPEED = 7.5;
const DASH_IMPULSE = 16;
const DASH_COOLDOWN = 0.85;

/**
 * Sumo Shove - the tutorial game. Stick to move, hold to charge, release to
 * slam. The plate shrinks on a timer so a stalemate cannot outlast the clock.
 *
 * Ring-outs are credited to whoever last touched the victim, which gives the
 * scoreboard something to say beyond "you fell off".
 */
class SumoShove implements Minigame {
  private readonly bodies = new Map<PlayerId, Entity>();
  private readonly knockouts = new Map<PlayerId, number>();
  private readonly lastTouch = new Map<PlayerId, { by: PlayerId; at: number }>();
  private readonly cooldown = new Map<PlayerId, number>();
  private readonly fallen: PlayerId[] = [];
  private plateEntity: Entity | null = null;
  private plateRing: THREE.Mesh | null = null;
  private radius = PLATE_START;
  private shrinkIn = SHRINK_EVERY;

  constructor(private readonly ctx: MinigameContext) {}

  build(): void {
    this.rebuildPlate();
    this.rebuildRing();

    const spawns = ringPositions(this.ctx.players.length, this.radius * 0.62);
    this.ctx.players.forEach((player, index) => {
      const at = spawns[index] as THREE.Vector3;
      const body = spawnPawnBody(this.ctx.physics, player, at, { restitution: 0.55, density: 1.5 });
      this.bodies.set(player.identity.id, body);
      this.knockouts.set(player.identity.id, 0);
    });

    // Credit ring-outs: remember the last player who touched each player.
    this.ctx.physics.contacts((a, b, started) => {
      if (!started) return;
      const idA = playerIdFromTag(a.tag);
      const idB = playerIdFromTag(b.tag);
      if (!idA || !idB) return;
      const now = this.ctx.elapsed;
      this.lastTouch.set(idA, { by: idB, at: now });
      this.lastTouch.set(idB, { by: idA, at: now });
    });

    this.ctx.stage.look({ x: 0, y: 10.5, z: 10.5 }, { x: 0, y: 0.4, z: 0 }, true, 3.5);
  }

  fixedUpdate(dt: number): void {
    for (const [id, remaining] of this.cooldown) {
      if (remaining > 0) this.cooldown.set(id, remaining - dt);
    }

    for (const { player, action } of this.ctx.input.drain()) {
      if (action.a !== 'dash') continue;
      const body = this.bodies.get(player);
      if (!body || (this.cooldown.get(player) ?? 0) > 0) continue;
      const frame = this.ctx.input.frame(player);
      const aim = clampDisc(deadzone(frame.x ?? 0), deadzone(frame.y ?? 0));
      // A dash with no stick input fires along current velocity, so a panicked
      // thumb still does something instead of nothing.
      const velocity = body.linvel;
      const dx = aim.x !== 0 || aim.y !== 0 ? aim.x : velocity.x;
      const dz = aim.x !== 0 || aim.y !== 0 ? -aim.y : velocity.z;
      const length = Math.hypot(dx, dz) || 1;
      const power = 0.45 + 0.55 * Math.min(1, action.charge);
      body.impulse((dx / length) * DASH_IMPULSE * power, 1.6 * power, (dz / length) * DASH_IMPULSE * power);
      this.cooldown.set(player, DASH_COOLDOWN);
      this.ctx.impact(0.18 * power, [player]);
    }

    for (const [id, body] of this.bodies) {
      const frame = this.ctx.input.frame(id);
      const aim = clampDisc(deadzone(frame.x ?? 0), deadzone(frame.y ?? 0));
      const velocity = body.linvel;
      const speed = Math.hypot(velocity.x, velocity.z);
      // Steering authority drops as you approach top speed: dashes stay special.
      const authority = speed > MAX_SPEED ? 0.15 : 1 - (speed / MAX_SPEED) * 0.45;
      const brake = held(frame, Btn.B) ? 2.4 : 1;
      body.force(aim.x * MOVE_FORCE * authority, 0, -aim.y * MOVE_FORCE * authority);
      if (brake > 1) body.force(-velocity.x * 6, 0, -velocity.z * 6);
    }

    this.shrinkIn -= dt;
    if (this.shrinkIn <= 0 && this.radius > PLATE_FLOOR) {
      this.shrinkIn = SHRINK_EVERY;
      this.radius = Math.max(PLATE_FLOOR, this.radius - SHRINK_BY);
      this.rebuildPlate();
      this.rebuildRing();
      this.ctx.impact(0.3);
    }

    this.checkFalls();
  }

  frame(dt: number): void {
    if (!this.plateRing) return;
    this.plateRing.rotation.z += dt * 0.25;
    // Settle the shrink punch back to rest.
    const scale = this.plateRing.scale.x;
    if (Math.abs(scale - 1) > 0.001) {
      const eased = scale + (1 - scale) * (1 - Math.exp(-7 * dt));
      this.plateRing.scale.setScalar(eased);
    }
  }

  private rebuildRing(): void {
    if (this.plateRing) this.ctx.decor.remove(this.plateRing);
    this.plateRing = marker(0xffc53d, this.radius);
    this.plateRing.position.y = 0.06;
    // Overshoot once so the shrink reads as an event, not a jump cut.
    this.plateRing.scale.setScalar(1.12);
    this.ctx.decor.add(this.plateRing);
  }

  private rebuildPlate(): void {
    // Rapier colliders cannot be resized, so a shrink is a swap. At one swap
    // every nine seconds the cost is irrelevant and the geometry stays exact.
    if (this.plateEntity) this.ctx.physics.remove(this.plateEntity);
    this.plateEntity = plate(this.ctx.physics, this.radius, 0, 0x1d2a4d);
  }

  private checkFalls(): void {
    for (const [id, body] of this.bodies) {
      const position = body.position;
      const outside = Math.hypot(position.x, position.z) > this.radius + 0.5;
      if (!outside && position.y > -3) continue;

      this.bodies.delete(id);
      this.fallen.push(id);
      this.ctx.physics.remove(body);

      const touch = this.lastTouch.get(id);
      if (touch && this.ctx.elapsed - touch.at < 2.5 && touch.by !== id) {
        this.knockouts.set(touch.by, (this.knockouts.get(touch.by) ?? 0) + 1);
        this.ctx.impact(0.45, [touch.by, id]);
      } else {
        this.ctx.impact(0.25, [id]);
      }
    }
  }

  rank(): PlayerId[] {
    const survivors = [...this.bodies.keys()].sort((a, b) => {
      const knockoutDiff = (this.knockouts.get(b) ?? 0) - (this.knockouts.get(a) ?? 0);
      if (knockoutDiff !== 0) return knockoutDiff;
      return this.centreDistance(a) - this.centreDistance(b);
    });
    return [...survivors, ...this.fallen.slice().reverse()];
  }

  isOver(): boolean {
    return this.bodies.size <= 1;
  }

  scoreLine(player: PlayerId): string {
    const knockouts = this.knockouts.get(player) ?? 0;
    const survived = this.bodies.has(player);
    const knockoutText = knockouts === 1 ? '1 ring-out' : knockouts + ' ring-outs';
    return survived ? 'still standing, ' + knockoutText : knockoutText;
  }

  banner(): string {
    return 'PLATE ' + this.radius.toFixed(1) + 'm';
  }

  private centreDistance(id: PlayerId): number {
    const body = this.bodies.get(id);
    if (!body) return Number.POSITIVE_INFINITY;
    return Math.hypot(body.position.x, body.position.z);
  }
}

export const sumoFactory: MinigameFactory = {
  meta: MINIGAMES.sumo,
  create: (ctx) => new SumoShove(ctx),
};
