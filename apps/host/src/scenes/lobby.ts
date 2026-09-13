import * as THREE from 'three';
import { MIN_PLAYERS, type ControllerToHost, type PlayerId, type PlayerIdentity } from '@topple/shared';
import { Scene, type SceneContext } from '../core/scene.js';
import { headerHtml, joinHtml, seatsHtml, setJoinLabel } from '../ui/overlay.js';
import { qrDataUrl } from '../ui/qr.js';
import { buildPad, buildPawn } from '../world/pawn.js';
import { marker, ringPositions } from '../world/arena.js';
import { GEOMETRY, disposeObject, material } from '../core/materials.js';

const TABLE_RADIUS = 6;

/**
 * The lobby is also the marketing shot: pawns drop onto the board as players
 * join so the TV is never a static join screen.
 *
 * Starting is deliberately two-way - every phone can hit READY, and whoever is
 * at the keyboard can press Space - because the person nearest the PC is not
 * always holding a phone.
 */
export class LobbyScene extends Scene<void> {
  private readonly group = new THREE.Group();
  private readonly pawns = new Map<PlayerId, THREE.Object3D>();
  private readonly ready = new Set<PlayerId>();
  private qr = '';
  private spin = 0;

  constructor(ctx: SceneContext) {
    super(ctx);
  }

  async enter(): Promise<void> {
    // The boot banner lives in the overlay until the first scene paints over it.
    this.ctx.ui.clear();

    const table = new THREE.Mesh(GEOMETRY.cylinder, material(0x16213f, { roughness: 0.95 }));
    table.scale.set(TABLE_RADIUS * 2, 0.6, TABLE_RADIUS * 2);
    table.position.y = -0.3;
    table.receiveShadow = true;
    this.group.add(table);

    const rim = marker(0xffc53d, TABLE_RADIUS, 0.07);
    rim.position.y = 0.02;
    this.group.add(rim);

    this.ctx.stage.scene.add(this.group);
    this.ctx.stage.look({ x: 0, y: 7.6, z: 8.2 }, { x: 0, y: 0.7, z: -1 }, true, 2.5);

    await this.refreshJoin();

    for (const player of this.ctx.roster.all()) this.addPawn(player.identity);
    this.paint();

    window.addEventListener('keydown', this.onKey);
  }

  override exit(): void {
    window.removeEventListener('keydown', this.onKey);
    disposeObject(this.group);
    this.ctx.ui.clear();
  }

  /** A reconnect mints a new room code, so the QR has to be redrawn. */
  override onRoomChanged(): void {
    void this.refreshJoin();
  }

  private async refreshJoin(): Promise<void> {
    const url = this.ctx.link.joinUrl;
    if (!url) return;
    setJoinLabel(url);
    this.qr = await qrDataUrl(url);
    this.paint();
  }

  override onPlayerJoined(player: PlayerIdentity): void {
    this.addPawn(player);
    this.layout();
    this.paint();
  }

  override onPlayerLeft(player: PlayerId): void {
    const pawn = this.pawns.get(player);
    if (pawn) disposeObject(pawn);
    this.pawns.delete(player);
    this.ready.delete(player);
    this.layout();
    this.paint();
  }

  override onPlayerMessage(from: PlayerId, message: ControllerToHost): void {
    if (message.t !== 'ready') return;
    if (message.on) this.ready.add(from);
    else this.ready.delete(from);
    this.paint();
    this.maybeStart();
  }

  override frame(dt: number): void {
    this.spin += dt * 0.35;
    for (const [id, pawn] of this.pawns) {
      pawn.rotation.y += dt * (this.ready.has(id) ? 2.2 : 0.5);
      const bob = this.ready.has(id) ? Math.abs(Math.sin(this.spin * 3)) * 0.18 : 0;
      pawn.position.y = bob;
    }
  }

  private addPawn(player: PlayerIdentity): void {
    if (this.pawns.has(player.id)) return;
    const holder = new THREE.Group();
    holder.add(buildPawn(player.shape, player.color, 1.9));
    const pad = buildPad(player.color, 0.95);
    pad.position.y = 0.02;
    holder.add(pad);
    this.group.add(holder);
    this.pawns.set(player.id, holder);
    this.layout();
  }

  private layout(): void {
    const ids = [...this.pawns.keys()];
    const positions = ringPositions(Math.max(ids.length, 1), TABLE_RADIUS * 0.58);
    ids.forEach((id, index) => {
      const pawn = this.pawns.get(id);
      const at = positions[index];
      if (pawn && at) {
        pawn.position.x = at.x;
        pawn.position.z = at.z;
        pawn.lookAt(0, pawn.position.y, 0);
      }
    });
  }

  private paint(): void {
    const players = this.ctx.roster.all();
    const readyCount = this.ready.size;
    const enough = players.length >= MIN_PLAYERS;

    this.ctx.ui.top(
      headerHtml('Topple Party', 'EVERYBODY IN', 'Physics minigames. One tower each. Last tower standing wins.') +
        joinHtml(this.ctx.link.code ?? '----', this.qr),
    );

    this.ctx.ui.bottom(
      '<div class="stack" style="width:100%">' +
        seatsHtml(players) +
        '<div class="center hint">' +
        (enough
          ? readyCount + ' of ' + players.length + ' ready &nbsp;&#183;&nbsp; everyone taps READY, or press SPACE here'
          : 'Need at least ' + MIN_PLAYERS + ' players') +
        '</div>' +
        '</div>',
    );
  }

  private maybeStart(): void {
    const players = this.ctx.roster.all();
    if (players.length < MIN_PLAYERS) return;
    if (players.some((player) => !this.ready.has(player.identity.id))) return;
    this.start();
  }

  private start(): void {
    if (this.finished) return;
    if (this.ctx.roster.all().length < MIN_PLAYERS) {
      this.ctx.ui.toast('Need ' + MIN_PLAYERS + ' players to start', 'bad');
      return;
    }
    this.finish();
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      this.start();
    }
  };
}
