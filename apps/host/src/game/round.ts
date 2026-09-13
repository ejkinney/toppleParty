import { pullsForPlace, type MinigameId, type PlayerId } from '@topple/shared';

export interface RoundResult {
  round: number;
  gameId: MinigameId;
  title: string;
  /** Best first. Always a total order of everyone who played the round. */
  order: PlayerId[];
  scoreLines: Map<PlayerId, string>;
}

export interface RoundOutcome {
  player: PlayerId;
  place: number;
  of: number;
  pulls: number;
  scoreLine: string;
}

/**
 * Turns a ranking into consequences. Kept out of both the minigames and the
 * scenes so the loss rule can be retuned in one place, and so a minigame never
 * has to know that Jenga exists.
 */
export function outcomesFor(result: RoundResult): RoundOutcome[] {
  const of = result.order.length;
  return result.order.map((player, index) => {
    const place = index + 1;
    return {
      player,
      place,
      of,
      pulls: pullsForPlace(place, of),
      scoreLine: result.scoreLines.get(player) ?? '',
    };
  });
}
