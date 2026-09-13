import { BALANCE, ordinal } from '@topple/shared';
import { Scene, type SceneContext } from '../core/scene.js';
import { escapeHtml, headerHtml, wait } from '../ui/overlay.js';
import type { RoundOutcome, RoundResult } from '../game/round.js';

/**
 * The scoreboard beat. Its only job is to make the punishment legible before
 * anybody is asked to touch their tower.
 */
export class ResultsScene extends Scene<void> {
  constructor(
    ctx: SceneContext,
    private readonly result: RoundResult,
    private readonly outcomes: RoundOutcome[],
  ) {
    super(ctx);
  }

  async enter(): Promise<void> {
    for (const outcome of this.outcomes) {
      this.ctx.link.to(outcome.player, {
        t: 'result',
        place: outcome.place,
        of: outcome.of,
        pulls: outcome.pulls,
        scoreLine: outcome.scoreLine,
      });
    }

    this.ctx.ui.top(headerHtml('Round ' + this.result.round, this.result.title, 'Results'));
    this.ctx.ui.middle('<div class="scoreboard">' + this.rows() + '</div>');
    this.ctx.ui.bottom('');

    const winner = this.outcomes[0];
    if (winner) {
      const player = this.ctx.roster.get(winner.player);
      if (player) {
        player.wins++;
        this.ctx.ui.toast(player.identity.name + ' takes the round', 'good');
      }
    }

    await wait(BALANCE.RESULTS_SECONDS * 1000);
    this.finish();
  }

  override exit(): void {
    this.ctx.ui.clear();
  }

  private rows(): string {
    return this.outcomes
      .map((outcome, index) => {
        const player = this.ctx.roster.get(outcome.player);
        if (!player) return '';
        const classes = ['score-row'];
        if (outcome.place === 1) classes.push('win');
        if (outcome.pulls > 0) classes.push('lose');

        const penalty =
          outcome.pulls === 0
            ? '<span class="pulls">safe</span>'
            : '<span class="pulls">-' + outcome.pulls + ' block' + (outcome.pulls === 1 ? '' : 's') + '</span>';

        return (
          '<div class="' + classes.join(' ') + '" style="animation-delay:' + index * 90 + 'ms">' +
          '<span class="place" style="color:' + player.identity.color + '">' + ordinal(outcome.place) + '</span>' +
          '<span class="stack">' +
          '<span>' + escapeHtml(player.identity.name) + '</span>' +
          '<span class="hint">' + escapeHtml(outcome.scoreLine) + '</span>' +
          '</span>' +
          penalty +
          '</div>'
        );
      })
      .join('');
  }
}
