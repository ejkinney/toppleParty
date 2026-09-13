import * as THREE from 'three';
import { MINIGAMES, clamp, deadzone, type PlayerId } from '@topple/shared';
import type { Minigame, MinigameContext, MinigameFactory } from './types.js';
import type { Entity } from '../core/physics.js';
import { GEOMETRY, material, shade } from '../core/materials.js';
import { framingDistance, lanePositions } from '../world/arena.js';

const TRAY_SIZE = 2.6;
const TRAY_THICKNESS = 0.14;
const TRAY_HEIGHT = 2.2;
const MAX_TILT = 0.4;
const MARBLE_RADIUS = 0.19;
const PAD_RADIUS = 0.34;
const LANE_SPACING = 3.6;

interface Rig {
  id: PlayerId;
  tray: Entity;
  marble: Entity | null;
  pads: THREE.Mesh[];
  litPad: number;
  score: number;
  droppedAt: number | null;
  origin: THREE.Vector3;
}

/**
 * Tilt Tray - the only minigame driven by the phone's orientation sensor.
 * Each player gets a private tray, so there is no interference between
 * players and the skill is purely the control surface.
 */
class TiltTray implements Minigame {
  private readonly rigs: Rig[] = [];
  private readonly dropOrder: PlayerId[] = [];
  private readonly scratch = new THREE.Vector3();

  constructor(private readonly ctx: MinigameContext) {}

  build(): void {
    const lanes = lanePositions(this.ctx.players.length, LANE_SPACING);

    this.ctx.players.forEach((player, index) => {
      const origin = (lanes[index] as THREE.Vector3).clone().setY(TRAY_HEIGHT);
      const color = new THREE.Color(player.identity.color);

      const visual = new THREE.Group();
      const board = new THREE.Mesh(GEOMETRY.box, material(shade(color, -0.3), { roughness: 0.8 }));
      board.scale.set(TRAY_SIZE, TRAY_THICKNESS, TRAY_SIZE);
      board.castShadow = true;
      board.receiveShadow = true;
      visual.add(board);

      const pads: THREE.Mesh[] = [];
      for (const [px, pz] of PAD_LAYOUT) {
        const pad = new THREE.Mesh(GEOMETRY.cylinder, material(0x2a3757, { roughness: 0.9 }));
        pad.scale.set(PAD_RADIUS * 2, 0.06, PAD_RADIUS * 2);
        pad.position.set(px * (TRAY_SIZE / 2 - PAD_RADIUS - 0.1), TRAY_THICKNESS / 2, pz * (TRAY_SIZE / 2 - PAD_RADIUS - 0.1));
        visual.add(pad);
        pads.push(pad);
      }

      // Kinematic: the tray is driven directly by the phone, never by forces.
      const tray = this.ctx.physics.spawn({
        kind: 'kinematic',
        shape: { kind: 'box', hx: TRAY_SIZE / 2, hy: TRAY_THICKNESS / 2, hz: TRAY_SIZE / 2 },
        position: origin,
        mesh: visual,
        friction: 0.55,
        restitution: 0.1,
        tag: 'tray:' + player.identity.id,
      });

      const marble = this.ctx.physics.spawn({
        shape: { kind: 'ball', r: MARBLE_RADIUS },
        position: { x: origin.x, y: origin.y + 0.4, z: origin.z },
        color: shade(color, 0.24),
        emissive: color,
        emissiveIntensity: 0.35,
        density: 3,
        friction: 0.4,
        restitution: 0.2,
        linearDamping: 0.25,
        angularDamping: 0.2,
        ccd: true,
        tag: 'marble:' + player.identity.id,
      });

      const rig: Rig = {
        id: player.identity.id,
        tray,
        marble,
        pads,
        litPad: 0,
        score: 0,
        droppedAt: null,
        origin,
      };
      this.lightPad(rig, Math.floor(this.ctx.rng() * PAD_LAYOUT.length));
      this.rigs.push(rig);
    });

    const width = Math.max(LANE_SPACING * this.ctx.players.length, 8);
    const distance = framingDistance(this.ctx.stage.camera, width);
    this.ctx.stage.look(
      { x: 0, y: TRAY_HEIGHT + distance * 0.42, z: distance * 0.85 },
      { x: 0, y: TRAY_HEIGHT - 0.4, z: 0 },
      true,
      3,
    );
  }

  fixedUpdate(_dt: number): void {
    for (const rig of this.rigs) {
      const frame = this.ctx.input.frame(rig.id);
      const tiltX = clamp(deadzone(frame.x ?? 0, 0.06), -1, 1);
      const tiltY = clamp(deadzone(frame.y ?? 0, 0.06), -1, 1);

      // Negative on both axes: a tilt to the right must drop the right edge.
      const euler = new THREE.Euler(-tiltY * MAX_TILT, 0, -tiltX * MAX_TILT, 'ZXY');
      const rotation = new THREE.Quaternion().setFromEuler(euler);
      rig.tray.body.setNextKinematicRotation(rotation);

      if (!rig.marble) continue;

      const marble = rig.marble.position;
      if (marble.y < TRAY_HEIGHT - 2.2) {
        this.ctx.physics.remove(rig.marble);
        rig.marble = null;
        rig.droppedAt = this.ctx.elapsed;
        this.dropOrder.push(rig.id);
        this.ctx.impact(0.2, [rig.id]);
        continue;
      }

      const pad = rig.pads[rig.litPad];
      if (!pad) continue;
      pad.getWorldPosition(this.scratch);
      if (this.scratch.distanceTo(marble) < PAD_RADIUS + MARBLE_RADIUS) {
        rig.score++;
        this.ctx.impact(0.06, [rig.id]);
        let next = rig.litPad;
        while (next === rig.litPad && PAD_LAYOUT.length > 1) {
          next = Math.floor(this.ctx.rng() * PAD_LAYOUT.length);
        }
        this.lightPad(rig, next);
      }
    }
  }

  private lightPad(rig: Rig, index: number): void {
    rig.pads.forEach((pad, i) => {
      pad.material = material(i === index ? 0xffc53d : 0x2a3757, {
        roughness: 0.9,
        emissive: i === index ? 0xffc53d : 0x000000,
        emissiveIntensity: i === index ? 1.2 : 0,
      });
    });
    rig.litPad = index;
  }

  rank(): PlayerId[] {
    return this.rigs
      .slice()
      .sort((a, b) => {
        // Anyone still holding a marble beats anyone who dropped theirs.
        if (!!a.marble !== !!b.marble) return a.marble ? -1 : 1;
        if (a.score !== b.score) return b.score - a.score;
        return (b.droppedAt ?? 0) - (a.droppedAt ?? 0);
      })
      .map((rig) => rig.id);
  }

  isOver(): boolean {
    return this.rigs.every((rig) => rig.marble === null);
  }

  scoreLine(player: PlayerId): string {
    const rig = this.rigs.find((entry) => entry.id === player);
    if (!rig) return '';
    const pads = rig.score === 1 ? '1 pad' : rig.score + ' pads';
    return rig.marble ? pads + ', marble safe' : pads + ', dropped at ' + (rig.droppedAt ?? 0).toFixed(0) + 's';
  }
}

/** Pad positions in tray-local space, as unit offsets from the centre. */
const PAD_LAYOUT: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
  [0, 0],
];

export const trayFactory: MinigameFactory = {
  meta: MINIGAMES.tray,
  create: (ctx) => new TiltTray(ctx),
};
