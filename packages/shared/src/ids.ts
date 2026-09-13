/** Branded primitives so a RoomCode can never be passed where a PlayerId belongs. */
export type PlayerId = string & { readonly __brand?: 'PlayerId' };
export type RoomCode = string & { readonly __brand?: 'RoomCode' };

/**
 * Room codes deliberately avoid vowels (so no accidental words appear) and the
 * I/1/O/0 family (unreadable from across a room on a TV).
 */
export const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
export const CODE_LENGTH = 4;

export function isRoomCode(value: string): value is RoomCode {
  if (value.length !== CODE_LENGTH) return false;
  for (const ch of value) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/**
 * Normalises whatever the player thumbed in on their phone into a comparable
 * code: upper-cases it, drops separators, and folds the lookalike glyphs that
 * are not in the alphabet onto the ones that are.
 */
export function normaliseCode(raw: string): string {
  const out: string[] = [];
  for (const ch of raw.toUpperCase()) {
    const folded = ch === 'I' || ch === '1' ? 'J' : ch === 'O' || ch === '0' ? 'Q' : ch;
    if (CODE_ALPHABET.includes(folded)) out.push(folded);
    if (out.length === CODE_LENGTH) break;
  }
  return out.join('');
}
