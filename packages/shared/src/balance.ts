/**
 * Every tunable number in the game lives here so designers can rebalance a
 * session without reading a line of engine code. Host and controller both read
 * these, which guarantees the phone tower and the TV mirror agree.
 */
export const BALANCE = {
  /** Fixed simulation rate. Host minigames and phone towers both step at this. */
  TICK_HZ: 60,
  /** How often a controller pushes analog input upstream. */
  INPUT_HZ: 30,
  /** How often a pulling phone streams its tower transforms to the TV. */
  TOWER_STREAM_HZ: 12,

  /** Blocks per level and levels per tower. 9 x 3 = 27 blocks. */
  TOWER_LEVELS: 9,
  TOWER_PER_LEVEL: 3,

  /** Losers each pull one block; dead last pulls this many. */
  PULLS_FOR_LAST: 2,
  PULLS_FOR_LOSER: 1,
  /**
   * Fraction of the field that loses a round, rounded up. 0.5 means the bottom
   * half pulls. Raise it to shorten a game, lower it to stretch one out.
   */
  LOSER_FRACTION: 0.5,

  /** Seconds a minigame runs before the clock forces a result. */
  ROUND_SECONDS: 45,
  /** Countdown shown on the TV and phones before a minigame goes live. */
  COUNTDOWN_SECONDS: 3,
  /** Scoreboard dwell before pawns walk to the table. */
  RESULTS_SECONDS: 6,
  /** Hard cap on a pull so one player cannot stall the party. */
  PULL_SECONDS: 30,
  /** Quiet time after a block leaves the tower before we judge a collapse. */
  SETTLE_SECONDS: 2.5,

  /** Reconnect grace before a silent phone is dropped from the roster. */
  RECONNECT_GRACE_MS: 45_000,
  HEARTBEAT_MS: 5_000,
  HEARTBEAT_TIMEOUT_MS: 15_000,
} as const;

/** How many players lose the round, given how many are still alive. */
export function loserCount(alive: number): number {
  if (alive <= 1) return 0;
  return Math.max(1, Math.min(alive - 1, Math.ceil(alive * BALANCE.LOSER_FRACTION)));
}

/** Blocks a given finishing place must pull. Place is 1-indexed. */
export function pullsForPlace(place: number, alive: number): number {
  const losers = loserCount(alive);
  const firstLosingPlace = alive - losers + 1;
  if (place < firstLosingPlace) return 0;
  return place === alive ? BALANCE.PULLS_FOR_LAST : BALANCE.PULLS_FOR_LOSER;
}
