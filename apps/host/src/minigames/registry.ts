import type { MinigameId } from '@topple/shared';
import type { MinigameFactory } from './types.js';
import { sumoFactory } from './sumo.js';
import { trayFactory } from './tray.js';
import { slingFactory } from './sling.js';
import { rampFactory } from './ramp.js';
import { debrisFactory } from './debris.js';

/**
 * Adding a minigame means writing one file and adding one line here. Nothing
 * else in the host, the server or the controller needs to change, as long as
 * the game reuses an existing control scheme.
 */
export const MINIGAME_REGISTRY: readonly MinigameFactory[] = [
  sumoFactory,
  trayFactory,
  slingFactory,
  rampFactory,
  debrisFactory,
];

export function factoryFor(id: MinigameId): MinigameFactory {
  const found = MINIGAME_REGISTRY.find((factory) => factory.meta.id === id);
  if (!found) throw new Error('no minigame registered for id ' + id);
  return found;
}

/**
 * Picks the next minigame. Everything playable is drawn once before anything
 * repeats, so an eight-round party never shows the same game twice in a row
 * and never leans on one game because its weight happened to be high.
 */
export class MinigameShuffler {
  private bag: MinigameFactory[] = [];
  private lastPlayed: MinigameId | null = null;

  constructor(private readonly rng: () => number) {}

  next(playerCount: number): MinigameFactory {
    const playable = MINIGAME_REGISTRY.filter((factory) => factory.meta.minPlayers <= playerCount);
    if (playable.length === 0) throw new Error('no minigame supports ' + playerCount + ' players');

    this.bag = this.bag.filter((factory) => playable.includes(factory));
    if (this.bag.length === 0) this.bag = this.weightedShuffle(playable);

    // The bag order is already random; the only override is refusing to open a
    // fresh bag with the game that closed the last one.
    let index = 0;
    if (this.bag.length > 1 && this.bag[0]?.meta.id === this.lastPlayed) index = 1;

    const [chosen] = this.bag.splice(index, 1);
    if (!chosen) throw new Error('shuffler produced nothing');
    this.lastPlayed = chosen.meta.id;
    return chosen;
  }

  /**
   * Weighted sampling without replacement (Efraimidis-Spirakis): give each
   * entry the key rng^(1/weight) and sort descending. Every game still appears
   * exactly once per bag; a heavier weight just tends to come out earlier.
   */
  private weightedShuffle(factories: readonly MinigameFactory[]): MinigameFactory[] {
    return factories
      .map((factory) => ({
        factory,
        key: Math.pow(Math.max(this.rng(), Number.EPSILON), 1 / Math.max(factory.meta.weight, 0.01)),
      }))
      .sort((a, b) => b.key - a.key)
      .map((entry) => entry.factory);
  }
}
