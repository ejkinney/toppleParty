/**
 * The minigame catalog is shared rather than host-owned on purpose: the host
 * sends a four-character id and the phone looks up its own control scheme,
 * title and rules locally. Nothing but the id crosses the wire.
 */

/** Control surfaces the phone knows how to render. One per feel, not per game. */
export const SCHEME_IDS = [
  /** Nothing to do - a spectator or waiting card. */
  'idle',
  /** Thumbstick plus a hold-to-charge shoulder button. */
  'stick-dash',
  /** Whole-phone tilt via device orientation, with a touch fallback pad. */
  'tilt-tray',
  /** Pull-back-and-release slingshot: aim and power from one drag. */
  'slingshot',
  /** Alternating left/right slap pads - cadence matters, not raw speed. */
  'mash-alt',
  /** Thumbstick plus a jump button. */
  'stick-jump',
  /** The between-round Jenga tower. */
  'jenga',
] as const;
export type SchemeId = (typeof SCHEME_IDS)[number];

export interface MinigameMeta {
  id: MinigameId;
  title: string;
  tagline: string;
  scheme: SchemeId;
  /** Two or three short lines. Shown on the TV during the intro and on phones. */
  rules: string[];
  /** Soft cap in seconds; a game may finish early. */
  duration: number;
  minPlayers: number;
  /** Higher means the director prefers it when variety allows. */
  weight: number;
}

export const MINIGAME_IDS = [
  'sumo',
  'tray',
  'sling',
  'ramp',
  'debris',
] as const;
export type MinigameId = (typeof MINIGAME_IDS)[number];

export const MINIGAMES: Record<MinigameId, MinigameMeta> = {
  sumo: {
    id: 'sumo',
    title: 'Sumo Shove',
    tagline: 'Last pawn on the plate',
    scheme: 'stick-dash',
    rules: ['Steer with the stick', 'Hold DASH to charge, release to slam', 'Fall off and you place last'],
    duration: 45,
    minPlayers: 2,
    weight: 1.2,
  },
  tray: {
    id: 'tray',
    title: 'Tilt Tray',
    tagline: 'Keep your marble home',
    scheme: 'tilt-tray',
    rules: ['Tilt your phone to tilt your tray', 'Roll the marble over the lit pads', 'Drop the marble and you are out'],
    duration: 40,
    minPlayers: 2,
    weight: 1,
  },
  sling: {
    id: 'sling',
    title: 'Slingshot Siege',
    tagline: 'Flatten your stack',
    scheme: 'slingshot',
    rules: ['Drag back to aim and load power', 'Release to fire', 'Topple your own blocks - fewest standing wins'],
    duration: 45,
    minPlayers: 2,
    weight: 1,
  },
  ramp: {
    id: 'ramp',
    title: 'Ramp Rush',
    tagline: 'Left, right, left, right',
    scheme: 'mash-alt',
    rules: ['Slap LEFT and RIGHT in turn', 'Alternating builds speed, double-tapping stalls', 'First boulder over the crest wins'],
    duration: 35,
    minPlayers: 2,
    weight: 1,
  },
  debris: {
    id: 'debris',
    title: 'Debris Dodge',
    tagline: 'The ceiling is falling',
    scheme: 'stick-jump',
    rules: ['Run with the stick, hop with JUMP', 'Blocks rain down and pile up', 'Survive longest to win'],
    duration: 50,
    minPlayers: 2,
    weight: 1.1,
  },
};

export function minigameMeta(id: MinigameId): MinigameMeta {
  return MINIGAMES[id];
}
