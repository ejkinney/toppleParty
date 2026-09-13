import type * as THREE from 'three';
import type { MinigameMeta, PlayerId } from '@topple/shared';
import type { PhysicsWorld } from '../core/physics.js';
import type { InputStore } from '../core/input-store.js';
import type { PlayerState } from '../game/roster.js';
import type { Stage } from '../core/stage.js';
import type { HostLink } from '../net/host-link.js';

export interface MinigameContext {
  /** A world built for this round and freed when it ends. */
  physics: PhysicsWorld;
  /** Decoration that is not simulated goes here. Removed wholesale on exit. */
  decor: THREE.Group;
  stage: Stage;
  input: InputStore;
  link: HostLink;
  /** Everyone playing this round, in seat order. Never empty. */
  players: PlayerState[];
  rng: () => number;
  /** Seconds since the round went live. */
  readonly elapsed: number;
  /** Nudges the camera and fires a phone buzz. Use for real moments only. */
  impact(strength: number, players?: PlayerId[]): void;
}

/**
 * The whole minigame contract. Five methods, no lifecycle surprises.
 *
 * `rank()` is deliberately always valid rather than only at the end: it feeds
 * the live TV standings, the phones' place readout, and the final result when
 * the clock runs out, so there is one ordering rule per game instead of three.
 */
export interface Minigame {
  build(): void;
  fixedUpdate(dt: number): void;
  frame?(dt: number, alpha: number): void;
  /** Current standings, best first. Must include every player exactly once. */
  rank(): PlayerId[];
  /** True once the outcome can no longer change; ends the round early. */
  isOver(): boolean;
  /** Short per-player line for the scoreboard, e.g. "4 pads" or "survived 22s". */
  scoreLine?(player: PlayerId): string;
  /** Extra HTML for the top-centre of the TV while playing. */
  banner?(): string;
  dispose?(): void;
}

export interface MinigameFactory {
  readonly meta: MinigameMeta;
  create(ctx: MinigameContext): Minigame;
}
