# Adding a minigame

If your game reuses an existing control scheme, this is **two files touched** and
nothing on the server or the phone.

## 1. Describe it

`packages/shared/src/catalog.ts` — add the id and its metadata. The phone reads
this catalogue locally, so the host only ever sends the id over the wire.

```ts
export const MINIGAME_IDS = ['sumo', 'tray', 'sling', 'ramp', 'debris', 'plinko'] as const;

plinko: {
  id: 'plinko',
  title: 'Peg Drop',
  tagline: 'Steer it on the way down',
  scheme: 'stick-dash',        // an existing scheme = no controller work
  rules: ['Nudge with the stick', 'Land in your own colour', 'Highest slot wins'],
  duration: 40,
  minPlayers: 2,
  weight: 1,
},
```

## 2. Write it

`apps/host/src/minigames/plinko.ts`. Five methods:

```ts
import { MINIGAMES, type PlayerId } from '@topple/shared';
import type { Minigame, MinigameContext, MinigameFactory } from './types.js';

class PegDrop implements Minigame {
  constructor(private readonly ctx: MinigameContext) {}

  build(): void {
    // ctx.physics is yours for the round and is freed when it ends.
    // ctx.decor is for anything unsimulated.
    // ctx.players is everyone playing, in seat order, never empty.
    this.ctx.stage.look({ x: 0, y: 12, z: 14 }, { x: 0, y: 2, z: 0 }, true);
  }

  fixedUpdate(dt: number): void {
    // Apply forces here; the scene steps physics immediately after.
    for (const { player, action } of this.ctx.input.drain()) { /* discrete taps */ }
    for (const player of this.ctx.players) {
      const frame = this.ctx.input.frame(player.identity.id); // analog state
    }
  }

  rank(): PlayerId[] {
    // Best first. Must always be a total order of ctx.players - this drives the
    // live TV standings, the phones' place readout AND the final result.
    return [];
  }

  isOver(): boolean {
    return false; // the clock ends it if you never do
  }

  scoreLine(player: PlayerId): string {
    return 'slot 7';
  }
}

export const plinkoFactory: MinigameFactory = {
  meta: MINIGAMES.plinko,
  create: (ctx) => new PegDrop(ctx),
};
```

## 3. Register it

`apps/host/src/minigames/registry.ts` — one import, one array entry. Done.

Check it with `http://localhost:5173/?game=plinko`, which pins every round to it.

## What you get for free

- A private `PhysicsWorld`, freed when the round ends.
- The intro card, rules screen, countdown, clock and scoreboard.
- Scheme delivery to phones, and an idle card for eliminated spectators.
- The results → meetup → Jenga consequence chain. Your game never learns that
  Jenga exists; `game/round.ts` turns your ranking into blocks owed.

## Helpers worth knowing

| Helper | From | Does |
| --- | --- | --- |
| `spawnPawnBody` | `world/arena.ts` | Upright body wearing the player's pawn |
| `ringPositions` / `lanePositions` | `world/arena.ts` | Spawn layouts; slot 0 is furthest from camera |
| `framingDistance` | `world/arena.ts` | Camera distance that fits N lanes, any player count |
| `plate` / `slab` / `bumpers` | `world/arena.ts` | Floors and invisible walls |
| `marker` | `world/arena.ts` | Glowing ring at a true radius |
| `ctx.impact(strength, ids?)` | `MinigameContext` | Camera punch + a buzz on those phones |
| `ctx.rng()` | `MinigameContext` | Seeded, so an arena can be reproduced |

## Adding a new control scheme

Only if no existing scheme fits. Schemes are per-*feel*, not per-game — two games
wanting a stick and a button should share one.

1. `packages/shared/src/catalog.ts` — add the id to `SCHEME_IDS`.
2. `apps/controller/src/schemes/<id>.ts` — export a `SchemeFactory` with
   `mount()` / `unmount()`. Build DOM directly; `el()` is the only helper.
3. `apps/controller/src/schemes/registry.ts` — one entry.

Send continuous state with `ctx.send.frame({ x, y, b, p, a })` and anything the
host must not miss with `ctx.send.act({ … })`. If you add a new action, extend
`ControllerAction` in `packages/shared/src/protocol.ts` and TypeScript will point
at every switch that needs a case.

## Balance

Every tunable number is in `packages/shared/src/balance.ts` — round length, who
loses, how many blocks last place pulls, tower size. Retuning a party is one file
and no game logic.
