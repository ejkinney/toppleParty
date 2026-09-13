import * as THREE from 'three';
import { MINIGAMES, clamp, type PlayerId } from '@topple/shared';
import type { Minigame, MinigameContext, MinigameFactory } from './types.js';
import type { Entity } from '../core/physics.js';
import { GEOMETRY, material, shade } from '../core/materials.js';
import { framingDistance, lanePositions, slab } from '../world/arena.js';

const LANE_SPACING = 4.6;
const STACK_COLUMNS = 3;
const STACK_ROWS = 3;
const BLOCK = { w: 0.62, h: 0.62, d: 0.62 };
const PEDESTAL_TOP = 1.0;
const AMMO = 8;
const SHOT_COOLDOWN = 0.55;
const PROJECTILE_LIFE = 4;
/** Where a player's shots originate, in front of their own stack. */
const LAUNCH_Z = 1.6;
const STACK_Z = -5;

interface Lane {
  id: PlayerId;
  origin: THREE.Vector3;
  blocks: Entity[];
  ammo: number;
  cooldown: number;
  arrow: THREE.Mesh;
  /** Last heading fired, in radians. Drives the chevron. */
  aim: number;
}

interface Projectile {
  entity: Entity;
  life: number;
}

/**
 * Slingshot Siege - aim and power come from one drag on the phone, which is
 * the most expressive single-gesture control in the set.
 *
 * The twist is that you demolish your OWN stack, so nobody can be griefed and
 * every player's arena is identical. Fewest blocks left standing wins.
 */
class SlingshotSiege implements Minigame {
  private readonly lanes: Lane[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly axis = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();

  constructor(private readonly ctx: MinigameContext) {}

  build(): void {
    const positions = lanePositions(this.ctx.players.length, LANE_SPACING);
    slab(this.ctx.physics, { x: LANE_SPACING * this.ctx.players.length + 6, y: 1, z: 22 }, { x: 0, y: -0.5, z: 0 }, 0x141d38);

    this.ctx.players.forEach((player, index) => {
      const origin = (positions[index] as THREE.Vector3).clone();
      const color = new THREE.Color(player.identity.color);

      slab(this.ctx.physics, { x: 3.2, y: PEDESTAL_TOP, z: 3.2 }, { x: origin.x, y: PEDESTAL_TOP / 2, z: origin.z + STACK_Z }, shade(color, -0.42).getHex());

      const blocks: Entity[] = [];
      for (let row = 0; row < STACK_ROWS; row++) {
        for (let column = 0; column < STACK_COLUMNS; column++) {
          blocks.push(
            this.ctx.physics.spawn({
              shape: { kind: 'box', hx: BLOCK.w / 2, hy: BLOCK.h / 2, hz: BLOCK.d / 2 },
              position: {
                x: origin.x + (column - (STACK_COLUMNS - 1) / 2) * (BLOCK.w + 0.03),
                y: PEDESTAL_TOP + BLOCK.h / 2 + row * (BLOCK.h + 0.005),
                z: origin.z + STACK_Z,
              },
              color: row % 2 === 0 ? color.getHex() : shade(color, 0.16).getHex(),
              density: 1.1,
              friction: 0.75,
              restitution: 0.05,
              tag: 'block:' + player.identity.id,
            }),
          );
        }
      }

      // A floating chevron shows the last aim taken, so spectators can read
      // what a player is doing without having to see their phone.
      const arrow = new THREE.Mesh(
        GEOMETRY.cone,
        material(shade(color, 0.28), { emissive: color, emissiveIntensity: 0.7, roughness: 0.35 }),
      );
      arrow.scale.set(0.44, 0.9, 0.44);
      arrow.position.set(origin.x, PEDESTAL_TOP + 0.9, origin.z + LAUNCH_Z);
      // The cone points along +Y by default; lay it down to point along -Z.
      arrow.rotation.x = -Math.PI / 2;
      this.ctx.decor.add(arrow);

      this.lanes.push({ id: player.identity.id, origin, blocks, ammo: AMMO, cooldown: 0, arrow, aim: 0 });
    });

    const width = Math.max(LANE_SPACING * this.ctx.players.length, 10);
    const distance = framingDistance(this.ctx.stage.camera, width);
    this.ctx.stage.look(
      { x: 0, y: distance * 0.62, z: LAUNCH_Z + distance * 0.78 },
      { x: 0, y: 1.4, z: STACK_Z + 1 },
      true,
      3,
    );
  }

  fixedUpdate(dt: number): void {
    for (const lane of this.lanes) lane.cooldown = Math.max(0, lane.cooldown - dt);

    for (const { player, action } of this.ctx.input.drain()) {
      if (action.a !== 'fire') continue;
      const lane = this.lanes.find((entry) => entry.id === player);
      if (!lane || lane.ammo <= 0 || lane.cooldown > 0) continue;
      this.fire(lane, action.aim, action.power);
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i] as Projectile;
      projectile.life -= dt;
      // Projectiles are the only unbounded entity source in the game, so they
      // are reaped on a timer rather than left to accumulate.
      if (projectile.life <= 0 || projectile.entity.position.y < -6) {
        this.ctx.physics.remove(projectile.entity);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private fire(lane: Lane, aim: number, power: number): void {
    const strength = clamp(power, 0.05, 1);
    const heading = clamp(aim, -0.9, 0.9);
    const speed = 11 + strength * 21;
    const direction = new THREE.Vector3(Math.sin(heading), 0.3 + strength * 0.16, -Math.cos(heading)).normalize();
    const start = new THREE.Vector3(lane.origin.x, PEDESTAL_TOP + 0.9, lane.origin.z + LAUNCH_Z);

    const ball = this.ctx.physics.spawn({
      shape: { kind: 'ball', r: 0.26 },
      position: start,
      color: 0xf3f6ff,
      emissive: 0xffc53d,
      emissiveIntensity: 0.4,
      density: 6,
      friction: 0.4,
      restitution: 0.25,
      ccd: true,
      tag: 'shot:' + lane.id,
    });
    ball.setLinvel(direction.x * speed, direction.y * speed, direction.z * speed);

    this.projectiles.push({ entity: ball, life: PROJECTILE_LIFE });
    lane.aim = heading;
    lane.ammo--;
    lane.cooldown = SHOT_COOLDOWN;
    this.ctx.impact(0.12 + strength * 0.14, [lane.id]);
  }

  frame(dt: number): void {
    for (const lane of this.lanes) {
      const spent = lane.ammo <= 0;
      lane.arrow.visible = !spent;
      if (spent) continue;
      // Ease toward the last heading and bob while the shot is on cooldown.
      // With the cone laid flat by rotation.x, a +Z roll swings it to -X, so
      // the heading is negated to match the direction the shot actually took.
      const targetYaw = -lane.aim;
      lane.arrow.rotation.z += (targetYaw - lane.arrow.rotation.z) * (1 - Math.exp(-9 * dt));
      const ready = lane.cooldown <= 0 ? 1 : 0.45;
      lane.arrow.position.y = PEDESTAL_TOP + 0.9 + Math.sin(this.ctx.elapsed * 3) * 0.06 * ready;
    }
  }

  /** A block counts as standing if it is still up high and still upright. */
  private standing(lane: Lane): number {
    let count = 0;
    for (const block of lane.blocks) {
      if (block.position.y < PEDESTAL_TOP + BLOCK.h * 0.35) continue;
      this.quat.copy(block.currQuaternion);
      this.axis.set(0, 1, 0).applyQuaternion(this.quat);
      if (this.axis.dot(this.up) < 0.82) continue;
      count++;
    }
    return count;
  }

  private settled(): boolean {
    for (const lane of this.lanes) {
      for (const block of lane.blocks) {
        const velocity = block.linvel;
        if (Math.hypot(velocity.x, velocity.y, velocity.z) > 0.25) return false;
      }
    }
    return this.projectiles.length === 0;
  }

  rank(): PlayerId[] {
    return this.lanes
      .slice()
      .sort((a, b) => {
        const diff = this.standing(a) - this.standing(b);
        if (diff !== 0) return diff;
        // Same damage: whoever did it with fewer shots was the better shot.
        return b.ammo - a.ammo;
      })
      .map((lane) => lane.id);
  }

  isOver(): boolean {
    if (this.lanes.some((lane) => lane.ammo > 0)) return false;
    return this.settled();
  }

  scoreLine(player: PlayerId): string {
    const lane = this.lanes.find((entry) => entry.id === player);
    if (!lane) return '';
    const left = this.standing(lane);
    return left + ' left standing, ' + (AMMO - lane.ammo) + ' shots';
  }

  banner(): string {
    const ammo = this.lanes.reduce((total, lane) => total + lane.ammo, 0);
    return ammo + ' shots left in the room';
  }
}

export const slingFactory: MinigameFactory = {
  meta: MINIGAMES.sling,
  create: (ctx) => new SlingshotSiege(ctx),
};
