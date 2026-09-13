import {
  TOTAL_BLOCKS,
  type PlayerId,
  type PlayerIdentity,
  type TowerSnapshot,
} from '@topple/shared';

export interface PlayerState {
  identity: PlayerIdentity;
  online: boolean;
  /** Tower has fallen. Eliminated players spectate; they keep their pawn on the board. */
  eliminated: boolean;
  /** Blocks still in the tower, mirrored from the phone. */
  blocks: number;
  /** Last transform snapshot the phone sent, for the TV mirror. */
  tower: TowerSnapshot | null;
  /** Pulls still owed from the last round. */
  pullsOwed: number;
  /** Minigames won, shown on the lobby cards and used as a tiebreak. */
  wins: number;
  /** Placing in the most recent minigame, 1-indexed. */
  lastPlace: number;
  /** Filled in when the tower falls: 2 means runner-up, and so on. */
  finalPlace: number;
  joinedAt: number;
}

/**
 * The party's source of truth. Minigames never mutate it - they return a
 * ranking and the director applies the consequences here.
 */
export class Roster {
  private readonly players = new Map<PlayerId, PlayerState>();
  /** Elimination order, earliest first. Drives final placings. */
  private readonly graveyard: PlayerId[] = [];

  get size(): number {
    return this.players.size;
  }

  add(identity: PlayerIdentity): PlayerState {
    const existing = this.players.get(identity.id);
    if (existing) {
      existing.identity = identity;
      existing.online = true;
      return existing;
    }
    const state: PlayerState = {
      identity,
      online: true,
      eliminated: false,
      blocks: TOTAL_BLOCKS,
      tower: null,
      pullsOwed: 0,
      wins: 0,
      lastPlace: 0,
      finalPlace: 0,
      joinedAt: Date.now(),
    };
    this.players.set(identity.id, state);
    return state;
  }

  get(id: PlayerId): PlayerState | undefined {
    return this.players.get(id);
  }

  remove(id: PlayerId): void {
    this.players.delete(id);
  }

  setOnline(id: PlayerId, online: boolean): void {
    const player = this.players.get(id);
    if (player) player.online = online;
  }

  all(): PlayerState[] {
    return [...this.players.values()].sort((a, b) => a.identity.seat - b.identity.seat);
  }

  /** Everyone whose tower still stands, in seat order. */
  alive(): PlayerState[] {
    return this.all().filter((player) => !player.eliminated);
  }

  /** Alive and actually holding a phone. Minigames only spawn these. */
  contenders(): PlayerState[] {
    return this.alive().filter((player) => player.online);
  }

  eliminate(id: PlayerId): PlayerState | undefined {
    const player = this.players.get(id);
    if (!player || player.eliminated) return undefined;
    player.eliminated = true;
    this.graveyard.push(id);
    // Last one knocked out takes the best of the losing places.
    player.finalPlace = this.players.size - this.graveyard.length + 1;
    return player;
  }

  /** Wipes towers and eliminations so the same lobby can run another party. */
  resetForNewGame(): void {
    this.graveyard.length = 0;
    for (const player of this.players.values()) {
      player.eliminated = false;
      player.blocks = TOTAL_BLOCKS;
      player.tower = null;
      player.pullsOwed = 0;
      player.wins = 0;
      player.lastPlace = 0;
      player.finalPlace = 0;
    }
  }

  /** Winner first. Survivors are ranked by blocks left, then minigame wins. */
  standings(): PlayerState[] {
    const survivors = this.alive().sort(
      (a, b) => b.blocks - a.blocks || b.wins - a.wins || a.joinedAt - b.joinedAt,
    );
    const fallen = this.graveyard
      .map((id) => this.players.get(id))
      .filter((player): player is PlayerState => Boolean(player))
      .reverse();
    return [...survivors, ...fallen];
  }
}
