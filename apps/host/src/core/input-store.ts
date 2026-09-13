import { EMPTY_INPUT, type ControllerAction, type InputFrame, type PlayerId } from '@topple/shared';

/**
 * The one place minigames read player intent from.
 *
 * Analog state is last-write-wins and lossy on purpose: a dropped frame is
 * invisible at 30Hz. Discrete actions are queued and drained once per fixed
 * step, so a tap that lands between renders is never swallowed.
 */
export class InputStore {
  private readonly frames = new Map<PlayerId, InputFrame>();
  private queue: { player: PlayerId; action: ControllerAction }[] = [];

  setFrame(player: PlayerId, frame: InputFrame): void {
    this.frames.set(player, frame);
  }

  pushAction(player: PlayerId, action: ControllerAction): void {
    // A phone that floods us cannot grow this without bound.
    if (this.queue.length > 256) this.queue.shift();
    this.queue.push({ player, action });
  }

  frame(player: PlayerId): InputFrame {
    return this.frames.get(player) ?? EMPTY_INPUT;
  }

  /** Returns and clears this step's actions. Call exactly once per fixed step. */
  drain(): { player: PlayerId; action: ControllerAction }[] {
    if (this.queue.length === 0) return EMPTY_ACTIONS;
    const actions = this.queue;
    this.queue = [];
    return actions;
  }

  forget(player: PlayerId): void {
    this.frames.delete(player);
    this.queue = this.queue.filter((entry) => entry.player !== player);
  }

  reset(): void {
    this.frames.clear();
    this.queue = [];
  }
}

const EMPTY_ACTIONS: { player: PlayerId; action: ControllerAction }[] = [];
