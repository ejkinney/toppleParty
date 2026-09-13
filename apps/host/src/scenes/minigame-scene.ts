import * as THREE from 'three';
import { BALANCE, type ControllerToHost, type PlayerId } from '@topple/shared';
import { Scene, type SceneContext } from '../core/scene.js';
import { PhysicsWorld } from '../core/physics.js';
import { disposeObject } from '../core/materials.js';
import { headerHtml, rulesHtml, seatsHtml, timerHtml, wait } from '../ui/overlay.js';
import type { Minigame, MinigameContext, MinigameFactory } from '../minigames/types.js';
import type { PlayerState } from '../game/roster.js';
import type { RoundResult } from '../game/round.js';

/** How often the TV's timer and the phones' place readout refresh. */
const HUD_INTERVAL = 0.5;

/**
 * Hosts one minigame: builds it a private physics world, runs the intro, keeps
 * the clock, and turns whatever the game reports into a RoundResult.
 *
 * Minigames never touch the network, the roster or the DOM - everything they
 * need arrives through MinigameContext, which is why each one is a single file.
 */
export class MinigameScene extends Scene<RoundResult> {
  private readonly physics = new PhysicsWorld({ events: true });
  private readonly decor = new THREE.Group();
  private readonly players: PlayerState[];
  private game: Minigame | null = null;
  private live = false;
  private elapsed = 0;
  private hudTimer = 0;

  constructor(
    ctx: SceneContext,
    private readonly factory: MinigameFactory,
    private readonly round: number,
  ) {
    super(ctx);
    this.players = ctx.roster.contenders();
  }

  async enter(): Promise<void> {
    const meta = this.factory.meta;
    this.ctx.stage.scene.add(this.physics.root, this.decor);

    // Captured before the literal so the `elapsed` getter reads the live value
    // rather than a snapshot taken at build time.
    const scene = this;
    const context: MinigameContext = {
      physics: this.physics,
      decor: this.decor,
      stage: this.ctx.stage,
      input: this.ctx.input,
      link: this.ctx.link,
      players: this.players,
      rng: this.ctx.rng,
      get elapsed() {
        return scene.elapsed;
      },
      impact: (strength, targets) => this.impact(strength, targets),
    };

    this.game = this.factory.create(context);
    this.game.build();

    // Spectators get an idle card; everyone playing gets the real controls.
    for (const player of this.ctx.roster.all()) {
      const playing = this.players.includes(player);
      this.ctx.link.to(player.identity.id, {
        t: 'scheme',
        scheme: playing ? meta.scheme : 'idle',
        game: meta.id,
        countdown: BALANCE.COUNTDOWN_SECONDS,
      });
    }

    this.ctx.ui.top(headerHtml('Round ' + this.round, meta.title, meta.tagline));
    this.ctx.ui.middle('<div class="card stack">' + rulesHtml(meta.rules) + '</div>');
    await wait(3200);

    this.ctx.ui.middle('');
    await this.ctx.ui.countdown(BALANCE.COUNTDOWN_SECONDS);

    // Anything tapped during the intro is discarded rather than queued.
    this.ctx.input.reset();
    this.live = true;
  }

  override fixedUpdate(dt: number): void {
    if (!this.live || !this.game || this.finished) return;
    this.elapsed += dt;

    this.game.fixedUpdate(dt);
    this.physics.step();

    if (this.game.isOver() || this.elapsed >= this.factory.meta.duration) {
      this.conclude();
    }
  }

  override frame(dt: number, alpha: number): void {
    this.physics.sync(alpha);
    this.game?.frame?.(dt, alpha);

    if (!this.live) return;
    this.hudTimer -= dt;
    if (this.hudTimer > 0) return;
    this.hudTimer = HUD_INTERVAL;
    this.paintHud();
  }

  override exit(): void {
    this.game?.dispose?.();
    this.physics.dispose();
    disposeObject(this.decor);
    this.ctx.ui.clear();
  }

  private paintHud(): void {
    const meta = this.factory.meta;
    const remaining = Math.max(0, meta.duration - this.elapsed);
    const banner = this.game?.banner?.() ?? meta.tagline;

    this.ctx.ui.top(headerHtml('Round ' + this.round, meta.title, banner) + timerHtml(remaining));
    this.ctx.ui.bottom('<div class="stack" style="width:100%">' + seatsHtml(this.ctx.roster.all()) + '</div>');

    const order = this.game?.rank() ?? [];
    order.forEach((id, index) => {
      const player = this.ctx.roster.get(id);
      if (!player) return;
      this.ctx.link.to(id, {
        t: 'hud',
        hud: {
          phase: 'minigame',
          round: this.round,
          alive: this.ctx.roster.alive().length,
          blocks: player.blocks,
          place: index + 1,
          note: Math.ceil(remaining) + 's left',
        },
      });
    });
  }

  private impact(strength: number, targets?: PlayerId[]): void {
    this.ctx.stage.punch(strength);
    if (!targets) return;
    // Buzz length tracks impact strength; phones clamp anything silly.
    const pattern = [Math.round(30 + strength * 120)];
    for (const id of targets) this.ctx.link.to(id, { t: 'haptic', pattern });
  }

  private conclude(): void {
    if (!this.game || this.finished) return;
    this.live = false;

    const order = this.game.rank();
    const scoreLines = new Map<PlayerId, string>();
    for (const id of order) {
      const line = this.game.scoreLine?.(id);
      if (line) scoreLines.set(id, line);
    }

    this.finish({
      round: this.round,
      gameId: this.factory.meta.id,
      title: this.factory.meta.title,
      order,
      scoreLines,
    });
  }

  override onPlayerMessage(from: PlayerId, message: ControllerToHost): void {
    if (message.t === 'input') this.ctx.input.setFrame(from, message.f);
    else if (message.t === 'act') this.ctx.input.pushAction(from, message.e);
  }

  override onPlayerLeft(player: PlayerId): void {
    this.ctx.input.forget(player);
  }
}
