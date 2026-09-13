import { MIN_PLAYERS, type MinigameId } from '@topple/shared';
import type { SceneContext, SceneRunner } from '../core/scene.js';
import { MinigameShuffler, factoryFor } from '../minigames/registry.js';
import { LobbyScene } from '../scenes/lobby.js';
import { MinigameScene } from '../scenes/minigame-scene.js';
import { ResultsScene } from '../scenes/results.js';
import { MeetupScene } from '../scenes/meetup.js';
import { GameOverScene } from '../scenes/gameover.js';
import { outcomesFor } from './round.js';

/** Safety valve: a party that somehow never eliminates anyone still ends. */
const MAX_ROUNDS = 40;

/**
 * The whole party, as one readable function.
 *
 * Because every scene resolves a promise when it is done, the flow is a plain
 * loop instead of a phase enum and a transition table - which is what makes it
 * obvious where a new phase would slot in.
 */
export class Director {
  constructor(
    private readonly ctx: SceneContext,
    private readonly runner: SceneRunner,
    /**
     * Dev override from ?game=<id>: pins every round to one minigame so a
     * single game can be played over and over while it is being tuned.
     */
    private readonly forced: MinigameId | null = null,
  ) {}

  async run(): Promise<void> {
    for (;;) {
      this.ctx.roster.resetForNewGame();
      this.ctx.link.lock(false);

      await this.runner.run(new LobbyScene(this.ctx));

      // Latecomers would have no tower and no fair way in, so the room locks.
      this.ctx.link.lock(true);

      const shuffler = new MinigameShuffler(this.ctx.rng);
      let round = 1;

      while (round <= MAX_ROUNDS) {
        const contenders = this.ctx.roster.contenders();
        if (this.ctx.roster.alive().length <= 1) break;
        if (contenders.length < MIN_PLAYERS) {
          // Everyone still alive has dropped off; end the party rather than
          // running a minigame nobody can play.
          this.ctx.ui.toast('Not enough players connected', 'bad');
          break;
        }

        const factory = this.forced ? factoryFor(this.forced) : shuffler.next(contenders.length);
        const result = await this.runner.run(new MinigameScene(this.ctx, factory, round));
        const outcomes = outcomesFor(result);

        for (const outcome of outcomes) {
          const player = this.ctx.roster.get(outcome.player);
          if (player) player.lastPlace = outcome.place;
        }

        await this.runner.run(new ResultsScene(this.ctx, result, outcomes));
        await this.runner.run(new MeetupScene(this.ctx, outcomes, round));
        round++;
      }

      await this.runner.run(new GameOverScene(this.ctx));
    }
  }
}
