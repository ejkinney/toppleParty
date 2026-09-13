# Architecture

Three processes, one shared vocabulary.

```
packages/shared ──────────────┬──────────────┬───────────────┐
  protocol, room codes,       │              │               │
  balance numbers, tower      ▼              ▼               ▼
  geometry               apps/server    apps/host      apps/controller
                         (relay)        (the TV)       (the phones)
```

`@topple/shared` is imported by all three and owns every type that crosses a
wire. Changing a message shape is a compile error in every place that reads it,
which is the main reason the whole game is one language.

## Who owns what

**The relay (`apps/server`) knows nothing about the game.** It allocates room
codes, keeps a roster of sockets, and forwards opaque payloads between the host
and the phones. It never inspects a minigame message. Game logic lives entirely
in the host, so adding a minigame never touches the server.

**The host is authoritative for minigames.** Phones send intent; the host
simulates and renders. There is no client prediction and no rollback — at LAN
latency the extra complexity buys nothing a party game can feel.

**Each phone is authoritative for its own tower.** The host never simulates a
Jenga tower. It receives transforms and renders them as a puppet
(`world/tower-mirror.ts`). Eight simultaneous 27-body simulations would be the
single most expensive thing on the TV, and a tower is a private, tactile object
that belongs in its owner's hands. The phone reports a verdict — still standing,
or collapsed — and the host believes it.

## Message flow

Two layers share one socket:

- **Transport** (`ControllerToServer`, `ServerToHost`, …) — joining, room codes,
  reconnects. The server reads these.
- **Game** (`ControllerToHost`, `HostToController`) — schemes, input, results,
  towers. The server forwards these without looking inside.

Liveness uses native WebSocket ping/pong frames, so a heartbeat never wakes the
game loop.

### Input has two channels, deliberately

| Channel | Message | Delivery | Used for |
| --- | --- | --- | --- |
| Analog | `input` | Lossy, ~30 Hz, coalesced | Stick, tilt, aim, charge |
| Discrete | `act` | Every one delivered, queued | Dash release, fire, jump, slap |

A dropped analog frame is invisible at 30 Hz. A dropped tap is a bug you can
feel. `InputSender` on the phone drops frames identical to the last one sent, so
a still thumb costs zero bandwidth; `InputStore` on the host keeps last-write-wins
analog state and a queue of actions drained exactly once per fixed step.

## The host loop

`core/loop.ts` runs a fixed 60 Hz simulation with an interpolated render pass.
Physics must run at exactly `BALANCE.TICK_HZ` or minigame tuning drifts with the
display; rendering runs at whatever the monitor does. `PhysicsWorld.sync(alpha)`
lerps each body between its previous and current transform, so a 144 Hz monitor
is smooth and a 30 Hz one is not in slow motion. The accumulator is clamped, so a
backgrounded tab resumes instead of trying to catch up over 600 steps.

## Scenes are promises, not a state machine

```ts
await run(new LobbyScene(ctx));
while (roster.alive().length > 1) {
  const result = await run(new MinigameScene(ctx, factory, round));
  const outcomes = outcomesFor(result);
  await run(new ResultsScene(ctx, result, outcomes));
  await run(new MeetupScene(ctx, outcomes, round));
}
await run(new GameOverScene(ctx));
```

A `Scene` resolves a promise when it is done, so the whole party reads as one
linear function in `game/director.ts` instead of a phase enum with a transition
table. `SceneRunner` guarantees `exit()` runs exactly once. Network events are
routed to whichever scene is current, and the roster is updated *before* the
scene sees them, so a scene never hears about a player the roster does not know.

## The minigame contract

Five methods (`minigames/types.ts`):

```ts
build()                      // construct the arena in a private physics world
fixedUpdate(dt)              // apply forces; the scene steps physics after
rank(): PlayerId[]           // current standings, always valid
isOver(): boolean            // true once the outcome cannot change
scoreLine?(id): string       // one line for the scoreboard
```

`rank()` being *always* valid rather than end-of-round only is what keeps each
game to one ordering rule: the same function feeds the live TV standings, the
phones' place readout, and the final result when the clock expires.

A minigame never touches the network, the roster, or the DOM. Everything it can
do arrives through `MinigameContext`. That is why each one is a single file, and
why `MinigameScene` can give each round a fresh `PhysicsWorld` that is freed when
the round ends.

## Consequences live outside the minigames

`game/round.ts` turns a ranking into pulls owed. A minigame does not know Jenga
exists; `BALANCE.LOSER_FRACTION` and `pullsForPlace()` decide who suffers. Tuning
the loss rule is one file, and no minigame changes.

## Performance notes

- One geometry per primitive, scaled per instance; materials cached by colour.
  A 200-block scene is a handful of GPU uploads.
- Rings are the exception — scaling a torus scales its tube, so `ringGeometry()`
  builds real geometry per radius and caches it.
- All readable text is DOM, not WebGL: crisp at any resolution, zero draw calls,
  and a scene repaint is one `innerHTML` write.
- Debris Dodge recycles blocks that have been motionless past a budget, so step
  cost stays flat however long a round runs.
- Rapier's WASM is a separate chunk. The phone loads ~45 KB to join; the tower
  engine streams in behind the lobby.
- The phone simulates its tower at 10× scale with 10× gravity. Dimensionally
  identical motion, in numbers the solver is happy with — a real Jenga block is
  7.5 cm long, which is small enough to make Rapier jittery.

## Reconnects

Phones drop. A resume token in `localStorage` restores the same seat, colour and
tower, and the reconnect path bypasses the room lock so a dropped player can
always walk back into a running game. The server holds a seat for
`BALANCE.RECONNECT_GRACE_MS` before evicting it. Tower state lives on the host as
well as the phone, so even a cleared browser gets its tower back.

A dropped **host** ends the room: the game state lives in the host's memory, so
resuming the room without it would be a lie.
