import type { PlayerId, RoomCode } from './ids.js';
import type { PlayerIdentity } from './players.js';
import type { MinigameId, SchemeId } from './catalog.js';
import type { TowerSnapshot } from './tower.js';

export const PROTOCOL_VERSION = 1;

export type GamePhase =
  | 'lobby'
  | 'intro'
  | 'minigame'
  | 'results'
  | 'meetup'
  | 'gameover';

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

/**
 * One analog frame from a phone, sent at BALANCE.INPUT_HZ and only when it
 * changed. Keys are single characters because this is the only message that
 * repeats thousands of times a session; every other message is readable.
 *
 * Fields are shared across schemes rather than per-scheme unions so the host
 * can read `frame.x` without knowing which minigame is running.
 */
export interface InputFrame {
  /** Stick or tilt, -1..1. Positive x is right, positive y is away from camera. */
  x?: number;
  y?: number;
  /** Held buttons, bitmask of Btn. */
  b?: number;
  /** Scheme scalar 0..1: dash charge, shot power, throttle. */
  p?: number;
  /** Scheme angle in radians: aim heading. */
  a?: number;
}

export const Btn = {
  A: 1 << 0,
  B: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
} as const;
export type BtnMask = number;

export function held(frame: InputFrame | undefined, bit: number): boolean {
  return ((frame?.b ?? 0) & bit) !== 0;
}

export const EMPTY_INPUT: Readonly<InputFrame> = Object.freeze({ x: 0, y: 0, b: 0, p: 0, a: 0 });

/**
 * Discrete impulses. Anything the host must not miss is an action, not a flag
 * on an input frame, because input frames are lossy by design.
 */
export type ControllerAction =
  | { a: 'ready'; on: boolean }
  | { a: 'dash'; charge: number }
  | { a: 'fire'; aim: number; power: number }
  | { a: 'jump' }
  | { a: 'slap'; side: 'l' | 'r' };

/* ------------------------------------------------------------------ *
 * Game messages: host <-> controller (the server only forwards these)
 * ------------------------------------------------------------------ */

export interface HudState {
  phase: GamePhase;
  round: number;
  /** Players still holding a standing tower. */
  alive: number;
  /** Blocks left in this player's tower. */
  blocks: number;
  /** Live placing inside the running minigame, 1-indexed, if meaningful. */
  place?: number;
  /** Short status line under the player's name on the phone. */
  note?: string;
  eliminated?: boolean;
}

export type HostToController =
  | { t: 'hello'; you: PlayerIdentity; hud: HudState }
  | { t: 'hud'; hud: HudState }
  /** Mount a control surface. `game` lets the phone look up rules locally. */
  | { t: 'scheme'; scheme: SchemeId; game?: MinigameId; countdown?: number }
  | { t: 'result'; place: number; of: number; pulls: number; scoreLine?: string }
  /** Open the tower for `pulls` extractions, optionally restoring prior state. */
  | { t: 'jenga'; pulls: number; snapshot?: TowerSnapshot }
  | { t: 'jengaClose' }
  | { t: 'toast'; text: string; tone?: 'good' | 'bad' | 'info' }
  | { t: 'haptic'; pattern: number[] }
  | { t: 'eliminated' }
  | { t: 'gameOver'; winner: string; yourPlace: number };

export type ControllerToHost =
  | { t: 'ready'; on: boolean }
  | { t: 'input'; f: InputFrame }
  | { t: 'act'; e: ControllerAction }
  /** Streamed while dragging so the TV can mirror the tower. */
  | { t: 'towerFrame'; snap: TowerSnapshot }
  /** Authoritative end-of-pull report: what the tower looks like now. */
  | { t: 'towerState'; blocks: number; collapsed: boolean; snap: TowerSnapshot; pullsLeft: number }
  | { t: 'rename'; name: string };

/* ------------------------------------------------------------------ *
 * Transport messages: endpoints <-> server
 *
 * Liveness is handled by native WebSocket ping/pong frames, not by app-level
 * messages, so a heartbeat never wakes the game loop.
 * ------------------------------------------------------------------ */

export type JoinRejection =
  | 'no-such-room'
  | 'room-full'
  | 'room-locked'
  | 'name-taken'
  | 'bad-version';

export type ControllerToServer =
  | { t: 'join'; v: number; code: RoomCode; name: string; token?: string }
  | { t: 'toHost'; m: ControllerToHost };

export type ServerToController =
  | { t: 'joined'; you: PlayerIdentity; token: string; code: RoomCode }
  | { t: 'rejected'; reason: JoinRejection; message: string }
  | { t: 'fromHost'; m: HostToController }
  | { t: 'hostLost' };

export type HostToServer =
  | { t: 'createRoom'; v: number }
  | { t: 'toPlayer'; to: PlayerId | '*'; m: HostToController }
  | { t: 'lock'; on: boolean }
  | { t: 'kick'; player: PlayerId };

export type ServerToHost =
  | { t: 'room'; code: RoomCode; joinUrl: string }
  | { t: 'playerJoined'; player: PlayerIdentity; resumed: boolean }
  /** Socket dropped but the seat is held open for BALANCE.RECONNECT_GRACE_MS. */
  | { t: 'playerOffline'; player: PlayerId }
  | { t: 'playerLeft'; player: PlayerId; reason: 'quit' | 'timeout' | 'kicked' }
  | { t: 'fromPlayer'; from: PlayerId; m: ControllerToHost }
  | { t: 'error'; message: string };

/* ------------------------------------------------------------------ *
 * Framing
 * ------------------------------------------------------------------ */

export function encode(message: unknown): string {
  return JSON.stringify(message);
}

/** Never throws: a malformed frame from a phone must not take down a room. */
export function decode<T>(raw: string): T | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof (parsed as { t?: unknown }).t !== 'string') return null;
    return parsed as T;
  } catch {
    return null;
  }
}
