import * as THREE from 'three';
import { ordinal } from '@topple/shared';
import { Scene, type SceneContext } from '../core/scene.js';
import { GEOMETRY, disposeObject, material } from '../core/materials.js';
import { escapeHtml, headerHtml } from '../ui/overlay.js';
import { buildPawn } from '../world/pawn.js';

/**
 * Podium. Waits for a human rather than a timer, because somebody always wants
 * a photo of the final board.
 */
export class GameOverScene extends Scene<void> {
  private readonly group = new THREE.Group();
  private spin = 0;

  constructor(ctx: SceneContext) {
    super(ctx);
  }

  enter(): void {
    const standings = this.ctx.roster.standings();
    const champion = standings[0];

    const plinth = new THREE.Mesh(GEOMETRY.cylinder, material(0x16213f, { roughness: 0.9 }));
    plinth.scale.set(4, 1.2, 4);
    plinth.position.y = 0.6;
    plinth.receiveShadow = true;
    this.group.add(plinth);

    if (champion) {
      const pawn = buildPawn(champion.identity.shape, champion.identity.color, 3.2);
      pawn.position.y = 1.2;
      this.group.add(pawn);
      // Each phone needs its own placing, so there is no broadcast here.
      for (const [index, player] of standings.entries()) {
        this.ctx.link.to(player.identity.id, {
          t: 'gameOver',
          winner: champion.identity.name,
          yourPlace: index + 1,
        });
      }
    }

    this.ctx.stage.scene.add(this.group);
    this.ctx.stage.look({ x: 0, y: 4.4, z: 9 }, { x: 0, y: 2.4, z: 0 }, true, 2);

    this.ctx.ui.top(
      headerHtml('Game over', champion ? champion.identity.name + ' WINS' : 'NOBODY WINS', 'Last tower standing'),
    );
    this.ctx.ui.middle(
      '<div class="scoreboard">' +
        standings
          .map((player, index) =>
            '<div class="score-row' + (index === 0 ? ' win' : '') + '" style="animation-delay:' + index * 110 + 'ms">' +
            '<span class="place" style="color:' + player.identity.color + '">' + ordinal(index + 1) + '</span>' +
            '<span>' + escapeHtml(player.identity.name) + '</span>' +
            '<span class="pulls">' + (player.eliminated ? 'toppled' : player.blocks + ' blocks') + '</span>' +
            '</div>',
          )
          .join('') +
        '</div>',
    );
    this.ctx.ui.bottom('<div class="center hint" style="width:100%">Press SPACE for another party</div>');

    window.addEventListener('keydown', this.onKey);
  }

  override frame(dt: number): void {
    this.spin += dt;
    this.group.rotation.y = this.spin * 0.4;
  }

  override exit(): void {
    window.removeEventListener('keydown', this.onKey);
    disposeObject(this.group);
    this.ctx.ui.clear();
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      this.finish();
    }
  };
}
