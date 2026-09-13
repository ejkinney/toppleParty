import * as THREE from 'three';
import {
  BALANCE,
  TOTAL_BLOCKS,
  clamp,
  snapshotBlockCount,
  type ControllerToHost,
  type PlayerId,
} from '@topple/shared';
import { Scene, type SceneContext } from '../core/scene.js';
import { GEOMETRY, disposeObject, material } from '../core/materials.js';
import { escapeHtml, headerHtml, seatsHtml } from '../ui/overlay.js';
import { buildPad, buildPawn } from '../world/pawn.js';
import { ringPositions } from '../world/arena.js';
import { TowerMirror } from '../world/tower-mirror.js';
import type { RoundOutcome } from '../game/round.js';

const TABLE_RADIUS = 6.2;
/**
 * Pawn and tower share a radius and sit a few degrees apart, so a player
 * stands BESIDE their tower. Putting the pawn further out on the same bearing
 * hid it behind the tower for whichever seat faced the camera.
 */
const SEAT_RADIUS = 4.0;
const SEAT_SPREAD = 0.26;
const WALK_SPEED = 3.2;

interface Seat {
  id: PlayerId;
  pawn: THREE.Group;
  mirror: TowerMirror;
  /** Where the pawn starts the scene and where it is walking to. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  walk: number;
  pullsOwed: number;
  resolved: boolean;
  collapsed: boolean;
}

/**
 * The between-rounds scene the whole game hangs off.
 *
 * Pawns gather at the table, then every loser pulls a block on their own phone
 * while the TV mirrors their tower live. The host never simulates a tower - it
 * puppets transforms the phones send - so eight towers cost eight draw calls
 * and the phone's physics is always the version of truth.
 */
export class MeetupScene extends Scene<void> {
  private readonly group = new THREE.Group();
  private readonly seats = new Map<PlayerId, Seat>();
  private readonly focus = new THREE.Vector3();
  private deadline = 0;
  private elapsed = 0;
  private focusUntil = 0;

  constructor(
    ctx: SceneContext,
    private readonly outcomes: RoundOutcome[],
    private readonly round: number,
  ) {
    super(ctx);
  }

  enter(): void {
    this.buildTable();

    const alive = this.ctx.roster.alive();
    const spots = ringPositions(Math.max(alive.length, 1), SEAT_RADIUS);
    const axis = new THREE.Vector3(0, 1, 0);

    alive.forEach((player, index) => {
      const seat = spots[index] as THREE.Vector3;
      const home = seat.clone().applyAxisAngle(axis, -SEAT_SPREAD);
      const towerAt = seat.clone().applyAxisAngle(axis, SEAT_SPREAD);

      const pawn = new THREE.Group();
      pawn.add(buildPawn(player.identity.shape, player.identity.color, 1.5));
      const pad = buildPad(player.identity.color, 0.8);
      pad.position.y = 0.02;
      pawn.add(pad);
      // Pawns start off the edge of the board and walk in.
      const start = home.clone().multiplyScalar(1.9);
      pawn.position.copy(start);
      this.group.add(pawn);

      const mirror = new TowerMirror(player.identity.color);
      mirror.group.position.copy(towerAt).setY(0.32);
      mirror.group.lookAt(0, 0.32, 0);
      if (player.tower) mirror.apply(player.tower);
      else mirror.applyPristine(player.blocks);
      this.group.add(mirror.group);

      const owed = this.outcomes.find((entry) => entry.player === player.identity.id)?.pulls ?? 0;
      player.pullsOwed = owed;

      this.seats.set(player.identity.id, {
        id: player.identity.id,
        pawn,
        mirror,
        from: start,
        to: home,
        walk: 0,
        pullsOwed: owed,
        resolved: owed === 0,
        collapsed: false,
      });
    });

    this.ctx.stage.scene.add(this.group);
    this.ctx.stage.look({ x: 0, y: 10.6, z: 9.4 }, { x: 0, y: 0.6, z: -1.2 }, true, 2.2);

    const maxPulls = Math.max(1, ...this.outcomes.map((outcome) => outcome.pulls));
    this.deadline = BALANCE.PULL_SECONDS * maxPulls + 8;

    this.paint();
    this.openTowers();
  }

  override exit(): void {
    for (const seat of this.seats.values()) seat.mirror.dispose();
    this.ctx.link.all({ t: 'jengaClose' });
    disposeObject(this.group);
    this.ctx.ui.clear();
  }

  /** Tells each loser's phone to open its tower, restoring its saved state. */
  private openTowers(): void {
    let anyPulls = false;
    for (const seat of this.seats.values()) {
      if (seat.pullsOwed <= 0) continue;
      anyPulls = true;
      const player = this.ctx.roster.get(seat.id);
      this.ctx.link.to(seat.id, {
        t: 'jenga',
        pulls: seat.pullsOwed,
        ...(player?.tower ? { snapshot: player.tower } : {}),
      });
    }
    if (!anyPulls) this.finish();
  }

  override fixedUpdate(dt: number): void {
    this.elapsed += dt;
    if (this.elapsed > this.deadline && !this.finished) {
      // A phone that never answers must not hold the party hostage.
      for (const seat of this.seats.values()) {
        if (!seat.resolved) this.ctx.ui.toast(this.nameOf(seat.id) + ' ran out of time', 'bad');
        seat.resolved = true;
      }
      this.finish();
    }
  }

  override frame(dt: number): void {
    for (const seat of this.seats.values()) {
      if (seat.walk < 1) {
        seat.walk = clamp(seat.walk + (dt * WALK_SPEED) / seat.from.distanceTo(seat.to), 0, 1);
        const eased = seat.walk * seat.walk * (3 - 2 * seat.walk);
        seat.pawn.position.lerpVectors(seat.from, seat.to, eased);
        seat.pawn.lookAt(0, seat.pawn.position.y, 0);
        // A little hop per step sells walking without an animation system.
        seat.pawn.position.y = Math.abs(Math.sin(seat.walk * 18)) * 0.14 * (1 - eased);
      }

      if (seat.collapsed) {
        seat.pawn.rotation.z = THREE.MathUtils.lerp(seat.pawn.rotation.z, Math.PI / 2.2, 1 - Math.exp(-4 * dt));
      }
    }

    if (this.elapsed < this.focusUntil) {
      this.ctx.stage.look({ x: this.focus.x * 1.9, y: 3.4, z: this.focus.z * 1.9 + 2.6 }, this.focus, false, 2.6);
    } else {
      this.ctx.stage.look({ x: 0, y: 10.6, z: 9.4 }, { x: 0, y: 0.6, z: -1.2 }, false, 1.6);
    }
  }

  override onPlayerMessage(from: PlayerId, message: ControllerToHost): void {
    const seat = this.seats.get(from);
    if (!seat) return;

    if (message.t === 'towerFrame') {
      seat.mirror.apply(message.snap);
      return;
    }

    if (message.t !== 'towerState') return;

    const player = this.ctx.roster.get(from);
    if (!player) return;

    seat.mirror.apply(message.snap);
    player.tower = message.snap;
    player.blocks = message.blocks || snapshotBlockCount(message.snap);
    seat.pullsOwed = Math.max(0, message.pullsLeft);
    player.pullsOwed = seat.pullsOwed;

    if (message.collapsed && !seat.collapsed) {
      seat.collapsed = true;
      seat.resolved = true;
      this.ctx.roster.eliminate(from);
      this.ctx.link.to(from, { t: 'eliminated' });
      this.ctx.ui.toast(this.nameOf(from) + "'s tower came down!", 'bad');
      this.ctx.stage.punch(0.9);
      this.focusOn(seat);
    } else if (seat.pullsOwed === 0) {
      seat.resolved = true;
      this.ctx.ui.toast(this.nameOf(from) + ' survives with ' + player.blocks + ' blocks', 'good');
    } else {
      this.focusOn(seat);
    }

    this.paint();
    if ([...this.seats.values()].every((entry) => entry.resolved)) {
      // Let the collapse land before cutting away.
      window.setTimeout(() => this.finish(), seat.collapsed ? 2600 : 1200);
    }
  }

  override onPlayerLeft(player: PlayerId): void {
    const seat = this.seats.get(player);
    if (seat) seat.resolved = true;
  }

  private focusOn(seat: Seat): void {
    this.focus.copy(seat.mirror.group.position).setY(1.2);
    this.focusUntil = this.elapsed + 3.5;
  }

  private nameOf(id: PlayerId): string {
    return this.ctx.roster.get(id)?.identity.name ?? 'Someone';
  }

  private buildTable(): void {
    const table = new THREE.Mesh(GEOMETRY.cylinder, material(0x16213f, { roughness: 0.95 }));
    table.scale.set(TABLE_RADIUS * 2, 0.6, TABLE_RADIUS * 2);
    table.position.y = -0.02;
    table.receiveShadow = true;
    this.group.add(table);

    const felt = new THREE.Mesh(GEOMETRY.cylinder, material(0x1d2a4d, { roughness: 1 }));
    felt.scale.set(TABLE_RADIUS * 1.86, 0.62, TABLE_RADIUS * 1.86);
    felt.position.y = 0.02;
    felt.receiveShadow = true;
    this.group.add(felt);
  }

  private paint(): void {
    const pulling = [...this.seats.values()].filter((seat) => !seat.resolved);
    const subtitle =
      pulling.length === 0
        ? 'Everyone survived. For now.'
        : pulling.map((seat) => escapeHtml(this.nameOf(seat.id))).join(', ') + ' must pull';

    this.ctx.ui.top(headerHtml('Between rounds', 'THE MEETUP', subtitle));
    this.ctx.ui.bottom(
      '<div class="stack" style="width:100%">' +
        seatsHtml(this.ctx.roster.all()) +
        '<div class="center hint">Pull a block on your phone &#183; never from the top course &#183; ' +
        TOTAL_BLOCKS +
        ' to start &#183; last tower standing wins</div>' +
        '</div>',
    );
  }
}
