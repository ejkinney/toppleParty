import * as THREE from 'three';
import { MINIGAMES, clamp, type PlayerId } from '@topple/shared';
import type { Minigame, MinigameContext, MinigameFactory } from './types.js';
import type { Entity } from '../core/physics.js';
import { shade } from '../core/materials.js';
import { framingDistance, lanePositions, marker, slab } from '../world/arena.js';

const LANE_SPACING = 3.2;
const RAMP_ANGLE = 0.3;
const RAMP_LENGTH = 20;
const BOULDER_RADIUS = 0.62;
const START_Z = 8;
const CREST_Z = -8;
const RAMP_HALF_THICKNESS = 0.25;
/** Total climb from the foot of the ramp to its far end. */
const RAMP_RISE = Math.sin(RAMP_ANGLE) * RAMP_LENGTH;
const RAMP_CENTER_Y = RAMP_RISE / 2;

const BASE_IMPULSE = 5.6;
/** Slapping the same pad twice in a row is a stall, not a shortcut. */
const WRONG_SIDE_FACTOR = 0.22;
/** Below this gap a slap reads as a double-tap and gets damped. */
const TOO_FAST = 0.09;
/** Above this gap the rhythm bonus has fully decayed. */
const TOO_SLOW = 0.7;

interface Racer {
  id: PlayerId;
  boulder: Entity;
  lastSide: 'l' | 'r' | null;
  lastSlapAt: number;
  rhythm: number;
  finishedAt: number | null;
  best: number;
}

/**
 * Ramp Rush - the whole game is one rhythm. Alternate the pads at a steady
 * cadence and the boulder climbs; panic-mash and it rolls back over you.
 *
 * There is no movement input at all, which makes it the cleanest read of
 * "different control scheme per minigame" in the set.
 */
class RampRush implements Minigame {
  private readonly racers: Racer[] = [];
  private readonly upSlope = new THREE.Vector3(0, Math.sin(RAMP_ANGLE), -Math.cos(RAMP_ANGLE));

  constructor(private readonly ctx: MinigameContext) {}

  build(): void {
    const lanes = lanePositions(this.ctx.players.length, LANE_SPACING);

    this.ctx.players.forEach((player, index) => {
      const lane = lanes[index] as THREE.Vector3;
      const color = new THREE.Color(player.identity.color);

      // One inclined slab per lane, rotated about X so it climbs toward -Z.
      this.ctx.physics.spawn({
        kind: 'fixed',
        shape: { kind: 'box', hx: LANE_SPACING * 0.46, hy: RAMP_HALF_THICKNESS, hz: RAMP_LENGTH / 2 },
        position: { x: lane.x, y: RAMP_CENTER_Y, z: 0 },
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(RAMP_ANGLE, 0, 0)),
        color: shade(color, -0.4).getHex(),
        friction: 0.95,
        restitution: 0.02,
        castShadow: false,
        tag: 'ramp:' + player.identity.id,
      });

      // Side rails keep a boulder in its own lane without a wall of colliders.
      for (const side of [-1, 1]) {
        this.ctx.physics.spawn({
          kind: 'fixed',
          shape: { kind: 'box', hx: 0.12, hy: 0.5, hz: RAMP_LENGTH / 2 },
          position: { x: lane.x + side * LANE_SPACING * 0.46, y: RAMP_CENTER_Y + 0.5, z: 0 },
          rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(RAMP_ANGLE, 0, 0)),
          visible: false,
          friction: 0.1,
          tag: 'rail',
        });
      }

      const startY = rampHeight(START_Z) + BOULDER_RADIUS + 0.3;
      const boulder = this.ctx.physics.spawn({
        shape: { kind: 'ball', r: BOULDER_RADIUS },
        position: { x: lane.x, y: startY, z: START_Z },
        color: color.getHex(),
        emissive: color,
        emissiveIntensity: 0.18,
        density: 1.6,
        friction: 0.9,
        restitution: 0.05,
        angularDamping: 0.4,
        ccd: true,
        tag: 'boulder:' + player.identity.id,
      });

      const crest = marker(0xffc53d, LANE_SPACING * 0.42, 0.08);
      crest.position.set(lane.x, rampHeight(CREST_Z) + 0.4, CREST_Z);
      // marker() lies the ring flat; the extra RAMP_ANGLE lays it on the slope.
      crest.rotation.set(Math.PI / 2 + RAMP_ANGLE, 0, 0);
      this.ctx.decor.add(crest);

      this.racers.push({
        id: player.identity.id,
        boulder,
        lastSide: null,
        lastSlapAt: -1,
        rhythm: 0,
        finishedAt: null,
        best: START_Z,
      });
    });

    slab(
      this.ctx.physics,
      { x: LANE_SPACING * this.ctx.players.length + 4, y: 1, z: 6 },
      { x: 0, y: -0.5, z: START_Z + 4 },
      0x141d38,
    );

    // The ramp is far longer than the lane bank is wide, so the camera has to
    // clear the length as well or the near end swallows the frame.
    const width = Math.max(LANE_SPACING * this.ctx.players.length, 9);
    const distance = framingDistance(this.ctx.stage.camera, width) + RAMP_LENGTH * 0.6;
    this.ctx.stage.look(
      { x: 0, y: RAMP_RISE * 0.8 + distance * 0.42, z: START_Z + distance * 0.74 },
      { x: 0, y: RAMP_RISE * 0.42, z: -1 },
      true,
      2.6,
    );
  }

  fixedUpdate(_dt: number): void {
    for (const { player, action } of this.ctx.input.drain()) {
      if (action.a !== 'slap') continue;
      const racer = this.racers.find((entry) => entry.id === player);
      if (!racer || racer.finishedAt !== null) continue;
      this.slap(racer, action.side);
    }

    for (const racer of this.racers) {
      const z = racer.boulder.position.z;
      racer.best = Math.min(racer.best, z);

      if (racer.finishedAt === null && z <= CREST_Z) {
        racer.finishedAt = this.ctx.elapsed;
        this.ctx.impact(0.4, [racer.id]);
      }

      // A boulder that escapes its lane is put back rather than lost.
      if (racer.boulder.position.y < -4) {
        racer.boulder.setPosition(racer.boulder.position.x, rampHeight(START_Z) + BOULDER_RADIUS + 0.4, START_Z);
        racer.boulder.setLinvel(0, 0, 0);
      }
    }
  }

  private slap(racer: Racer, side: 'l' | 'r'): void {
    const now = this.ctx.elapsed;
    const gap = racer.lastSlapAt < 0 ? 0.3 : now - racer.lastSlapAt;
    racer.lastSlapAt = now;

    const alternated = racer.lastSide === null || racer.lastSide !== side;
    racer.lastSide = side;

    // Rhythm is a rolling score in 0..1. Hitting the sweet-spot cadence keeps
    // it high; machine-gunning one pad or drifting off tempo bleeds it away.
    const tempo =
      gap < TOO_FAST ? 0.15 : gap > TOO_SLOW ? 0.25 : 1 - Math.abs(gap - 0.26) / (TOO_SLOW - 0.26) * 0.6;
    racer.rhythm = clamp(racer.rhythm * 0.65 + (alternated ? tempo : 0) * 0.35, 0, 1);

    const strength = BASE_IMPULSE * (alternated ? 0.55 + racer.rhythm * 0.9 : WRONG_SIDE_FACTOR);
    racer.boulder.impulse(
      this.upSlope.x * strength,
      this.upSlope.y * strength,
      this.upSlope.z * strength,
    );
  }

  private progress(racer: Racer): number {
    return clamp((START_Z - racer.boulder.position.z) / (START_Z - CREST_Z), 0, 1);
  }

  rank(): PlayerId[] {
    return this.racers
      .slice()
      .sort((a, b) => {
        if (a.finishedAt !== null || b.finishedAt !== null) {
          if (a.finishedAt === null) return 1;
          if (b.finishedAt === null) return -1;
          return a.finishedAt - b.finishedAt;
        }
        return a.best - b.best;
      })
      .map((racer) => racer.id);
  }

  isOver(): boolean {
    return this.racers.every((racer) => racer.finishedAt !== null);
  }

  scoreLine(player: PlayerId): string {
    const racer = this.racers.find((entry) => entry.id === player);
    if (!racer) return '';
    if (racer.finishedAt !== null) return 'crested in ' + racer.finishedAt.toFixed(1) + 's';
    return Math.round(this.progress(racer) * 100) + '% up the ramp';
  }

  banner(): string {
    const done = this.racers.filter((racer) => racer.finishedAt !== null).length;
    return done > 0 ? done + ' over the crest' : 'left, right, left, right';
  }
}

/**
 * Height of the ramp's top surface at a world z. Derived from the slab's own
 * centre and tilt so geometry, spawns and the crest marker can never drift
 * apart when RAMP_ANGLE or RAMP_LENGTH is retuned.
 */
function rampHeight(z: number): number {
  return RAMP_CENTER_Y + RAMP_HALF_THICKNESS * Math.cos(RAMP_ANGLE) - z * Math.tan(RAMP_ANGLE);
}

export const rampFactory: MinigameFactory = {
  meta: MINIGAMES.ramp,
  create: (ctx) => new RampRush(ctx),
};
