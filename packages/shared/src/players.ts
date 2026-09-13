import type { PlayerId } from './ids.js';

/** Board-game pawns. Each is built from primitives on the host, so nothing loads. */
export const TOKEN_SHAPES = [
  'tophat',
  'boot',
  'racecar',
  'thimble',
  'dog',
  'battleship',
  'wheelbarrow',
  'iron',
] as const;
export type TokenShape = (typeof TOKEN_SHAPES)[number];

/** Seat colours: high chroma, separable for common colour-blind types, TV-readable. */
export const SEAT_COLORS = [
  '#ff4d5a',
  '#3da5ff',
  '#ffc53d',
  '#4ade80',
  '#c084fc',
  '#ff8f3d',
  '#22d3ee',
  '#f472b6',
] as const;

export const MAX_PLAYERS = SEAT_COLORS.length;
export const MIN_PLAYERS = 2;

export interface PlayerIdentity {
  id: PlayerId;
  name: string;
  /** Stable index 0..MAX_PLAYERS-1. Drives colour, pawn shape and spawn slot. */
  seat: number;
  color: string;
  shape: TokenShape;
}

export const NAME_MAX_LENGTH = 12;

/** Strips control characters and collapses whitespace; never returns an empty string. */
export function sanitiseName(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  out = out.split(/\s+/).join(' ').trim().slice(0, NAME_MAX_LENGTH).toUpperCase();
  return out.length > 0 ? out : 'PLAYER';
}

export function seatColor(seat: number): string {
  return SEAT_COLORS[seat % SEAT_COLORS.length] as string;
}

export function seatShape(seat: number): TokenShape {
  return TOKEN_SHAPES[seat % TOKEN_SHAPES.length] as TokenShape;
}
