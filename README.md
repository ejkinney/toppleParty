# Topple Party

A Jackbox-style physics party game for PC. The game runs on one screen; everyone
else plays on the phone already in their pocket — scan a QR code or type a
four-letter room code, no app install.

Every round is a different physics minigame with a **different control scheme on
the phone**. Between rounds the players' board-game pawns gather at a table and
everyone who lost pulls a block out of their own Jenga tower — a real 3D physics
simulation running on that player's phone. When your tower falls, you are out.
Last tower standing wins.

```
  PC / TV                  relay (Node)                phones
  ┌───────────────┐        ┌───────────┐        ┌────────────────────┐
  │ minigames     │  ws    │ rooms     │  ws    │ control schemes    │
  │ meetup board  │◄──────►│ codes     │◄──────►│ Jenga tower (3D)   │
  │ tower mirrors │        │ routing   │        │ reconnect tokens   │
  └───────────────┘        └───────────┘        └────────────────────┘
```

## Running it

```bash
npm install
npm run dev
```

The banner prints two URLs:

| What | Where |
| --- | --- |
| TV / host display | `http://localhost:5173/` |
| Phones | `http://<your-lan-ip>:5174/` |

Phones must be on the same Wi-Fi as the PC. Open the host page on the TV, and the
lobby shows a QR code that encodes the phone URL with the room code already in it.

Production build — one Node process serves both pages and the relay:

```bash
npm run build
npm start                      # http://<lan-ip>:3000  (phones)
                               # http://<lan-ip>:3000/host  (TV)
```

Playing over the internet instead of a LAN: point `PUBLIC_BASE_URL` at a tunnel
(ngrok, Cloudflare Tunnel) and the QR code follows.

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WebSocket port |
| `PUBLIC_BASE_URL` | — | Overrides the join URL in the QR code |
| `CONTROLLER_PORT` | `5174` | Vite's port, used for the dev join URL |
| `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug` |

## Playing

1. Everyone joins and taps **READY** (or whoever is at the PC presses **Space**).
2. A minigame runs for up to ~45 seconds. Your phone shows the controls for it.
3. The scoreboard ranks everyone. The bottom half loses; **last place loses twice**.
4. At the meetup, every loser pulls a block out of their tower on their phone
   while the TV mirrors it live.
5. Tower falls → eliminated. Repeat until one player is left.

## The minigames

| Game | Phone controls | How you win |
| --- | --- | --- |
| **Sumo Shove** | Thumbstick + hold-to-charge dash | Last pawn on a shrinking plate |
| **Tilt Tray** | Physically tilt the phone | Roll your marble over lit pads, don't drop it |
| **Slingshot Siege** | Pull back and release | Flatten your own stack — fewest blocks left standing |
| **Ramp Rush** | Alternating left/right slap pads | Push your boulder over the crest; rhythm beats mashing |
| **Debris Dodge** | Thumbstick + jump | Survive longest as blocks rain down and pile up |

Force one while tuning it: `http://localhost:5173/?game=sumo` (`sumo`, `tray`,
`sling`, `ramp`, `debris`). Add `?tower=9` to start everyone on a short tower so
the endgame arrives quickly.

## Layout

```
packages/shared      wire protocol, room codes, balance numbers, tower geometry
apps/server          Node + ws relay: rooms, codes, reconnects, static serving
apps/host            the TV: Three.js + Rapier, minigames, meetup board
apps/controller      the phone: control schemes + its own Jenga simulation
scripts/dev.mjs      runs all three with a join-URL banner
scripts/smoke.mjs    end-to-end browser test of a whole round
scripts/playtest.mjs plays a full game, pulling real blocks, to a winner
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for why it is split this way,
and [`docs/ADDING_A_MINIGAME.md`](docs/ADDING_A_MINIGAME.md) to add one.

## Checks

```bash
npm run typecheck      # tsc -b across every workspace

# The smoke test drives real browsers, so it asks for Playwright separately -
# installing it by default would pull ~150MB of Chromium onto everyone who
# only wants to play.
npm install --no-save playwright && npx playwright install chromium
npm run smoke          # boots the build, drives two phones through a full round
npm run playtest       # plays a whole game out, pulling real blocks, to a winner
```

`smoke` opens the host in a real browser, joins two controllers, reloads one to
check it resumes its seat, readies up, plays a round, and asserts the scoreboard,
the meetup and the tower all appear.

`playtest` goes further: it drags blocks out of towers with a real pointer, so it
covers the grab raycast, the drag spring, extraction, collapse detection,
elimination and the winner screen — the part of the game that only exists under a
finger. It starts towers short (`--tower=9`) so the endgame arrives in a few
rounds instead of fifteen.

Everything interesting in this game lives in seams a type checker cannot see.

## Stack, and why

**TypeScript + Vite + Three.js + Rapier + Node/ws** rather than Unity or Godot.

The phone controller is the deciding constraint: joining by QR with no install
means the controller is a web page whatever the host is built in. Putting the
host in the same language lets all three processes share one typed protocol
package, so a change to a message is a compile error in every place that reads
it. Rapier (Rust compiled to WASM) runs the same deterministic physics on the TV
and on the phone, so the Jenga tower is the same engine as the minigames. The
host is a browser page today and wraps in Tauri or Electron for a desktop
executable without touching game code.

## Licence

MIT.
