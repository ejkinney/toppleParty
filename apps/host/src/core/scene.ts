import type { ControllerToHost, PlayerId, PlayerIdentity } from '@topple/shared';
import type { HostLink } from '../net/host-link.js';
import type { Roster } from '../game/roster.js';
import type { InputStore } from './input-store.js';
import type { Overlay } from '../ui/overlay.js';
import type { Stage } from './stage.js';

export interface SceneContext {
  stage: Stage;
  ui: Overlay;
  link: HostLink;
  roster: Roster;
  input: InputStore;
  rng: () => number;
}

/**
 * A scene owns the screen until it resolves. Because completion is a promise,
 * the whole party flow reads as a linear async function in the director rather
 * than as a state enum with transition tables.
 */
export abstract class Scene<T = void> {
  readonly done: Promise<T>;
  private resolve!: (value: T) => void;
  private settled = false;

  constructor(protected readonly ctx: SceneContext) {
    this.done = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }

  /** Idempotent: a scene that finishes twice (clock plus win condition) is fine. */
  protected finish(value: T): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
  }

  get finished(): boolean {
    return this.settled;
  }

  abstract enter(): void | Promise<void>;

  fixedUpdate(_dt: number): void {}

  frame(_dt: number, _alpha: number): void {}

  exit(): void {}

  onPlayerMessage(_from: PlayerId, _message: ControllerToHost): void {}

  onPlayerJoined(_player: PlayerIdentity, _resumed: boolean): void {}

  onPlayerLeft(_player: PlayerId): void {}

  /** The relay handed us a new room code, usually after a reconnect. */
  onRoomChanged(): void {}
}

/** Drives one scene at a time and guarantees exit() runs exactly once. */
export class SceneRunner {
  current: Scene<unknown> | null = null;

  async run<T>(scene: Scene<T>): Promise<T> {
    this.current = scene as Scene<unknown>;
    try {
      await scene.enter();
      return await scene.done;
    } finally {
      scene.exit();
      if (this.current === (scene as Scene<unknown>)) this.current = null;
    }
  }

  fixedUpdate(dt: number): void {
    this.current?.fixedUpdate(dt);
  }

  frame(dt: number, alpha: number): void {
    this.current?.frame(dt, alpha);
  }
}
