import './style.css';
import { BALANCE, MINIGAME_IDS, makeRng, type MinigameId } from '@topple/shared';
import { Stage } from './core/stage.js';
import { Loop } from './core/loop.js';
import { initPhysics } from './core/physics.js';
import { InputStore } from './core/input-store.js';
import { SceneRunner, type SceneContext } from './core/scene.js';
import { Overlay } from './ui/overlay.js';
import { Roster } from './game/roster.js';
import { HostLink } from './net/host-link.js';
import { Director } from './game/director.js';

/** Reads the ?game=<id> dev override, ignoring anything unrecognised. */
function forcedMinigame(): MinigameId | null {
  const requested = new URLSearchParams(location.search).get('game');
  return requested && (MINIGAME_IDS as readonly string[]).includes(requested)
    ? (requested as MinigameId)
    : null;
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  const overlayRoot = document.getElementById('overlay');
  if (!canvas || !overlayRoot) throw new Error('host page is missing its mount points');

  const ui = new Overlay(overlayRoot);
  ui.middle('<div class="banner"><h1 class="title">TOPPLE PARTY</h1><p class="subtitle">warming up the physics...</p></div>');

  // The wasm compile is the only real load in the game; do it before anything
  // asks for a rigid body rather than mid-round.
  await initPhysics();

  const stage = new Stage(canvas);
  const roster = new Roster();
  const input = new InputStore();
  const link = new HostLink();
  const runner = new SceneRunner();

  const ctx: SceneContext = {
    stage,
    ui,
    link,
    roster,
    input,
    rng: makeRng(Date.now() & 0xffffffff),
  };

  /* Network events update the roster first, then reach the running scene, so a
   * scene never sees a player the roster has not heard of. */
  link.on('room', () => runner.current?.onRoomChanged());
  link.on('playerJoined', (identity, resumed) => {
    roster.add(identity);
    runner.current?.onPlayerJoined(identity, resumed);
    if (resumed) ui.toast(identity.name + ' reconnected', 'good');
  });
  link.on('playerOffline', (id) => {
    roster.setOnline(id, false);
    input.forget(id);
    const player = roster.get(id);
    if (player) ui.toast(player.identity.name + ' dropped out', 'bad');
  });
  link.on('playerLeft', (id) => {
    const player = roster.get(id);
    runner.current?.onPlayerLeft(id);
    roster.remove(id);
    input.forget(id);
    if (player) ui.toast(player.identity.name + ' left', 'bad');
  });
  link.on('message', (from, message) => {
    if (message.t === 'rename') {
      const player = roster.get(from);
      if (player) player.identity = { ...player.identity, name: message.name };
    }
    runner.current?.onPlayerMessage(from, message);
  });
  link.on('status', (state) => {
    if (state === 'closed') ui.toast('Lost the relay - reconnecting', 'bad');
  });

  const loop = new Loop(
    {
      fixedUpdate: (dt) => runner.fixedUpdate(dt),
      frame: (dt, alpha) => {
        runner.frame(dt, alpha);
        stage.frame(dt);
      },
    },
    BALANCE.TICK_HZ,
  );

  let perfTimer = 0;
  const perfLoop = (): void => {
    perfTimer = window.setTimeout(perfLoop, 500);
    ui.perf(loop.fps.toFixed(0) + ' fps  ' + loop.stepMs.toFixed(1) + ' ms sim');
  };
  perfLoop();
  window.addEventListener('beforeunload', () => window.clearTimeout(perfTimer));

  link.connect();
  loop.start();

  // Nothing can be joined until the relay answers, so the lobby waits for it
  // rather than painting a placeholder code somebody might type in.
  await link.opened;

  const director = new Director(ctx, runner, forcedMinigame());
  await director.run();
}

boot().catch((error: unknown) => {
  console.error(error);
  const overlay = document.getElementById('overlay');
  if (overlay) {
    overlay.innerHTML =
      '<div class="banner"><h1 class="title fatal">CRASH</h1><p class="subtitle">' +
      String(error instanceof Error ? error.message : error) +
      '</p><p class="hint">Check the console, then reload.</p></div>';
  }
});
