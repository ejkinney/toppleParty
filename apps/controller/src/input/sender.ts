import { BALANCE, type ControllerAction, type InputFrame } from '@topple/shared';
import type { ControllerLink } from '../net/link.js';

const MIN_INTERVAL = 1000 / BALANCE.INPUT_HZ;
/** Below this, an axis change is thumb noise rather than intent. */
const AXIS_EPSILON = 0.015;

/**
 * Rate-limits analog input and drops frames that say nothing new.
 *
 * A thumbstick held still would otherwise push 30 identical messages a second
 * per player. Coalescing here means a still hand costs zero bandwidth, and a
 * moving one costs one small message per tick - which is what keeps eight
 * phones on hotel Wi-Fi playable.
 */
export class InputSender {
  private pending: InputFrame | null = null;
  private lastSent: InputFrame = {};
  private lastSentAt = 0;
  private timer = 0;

  constructor(private readonly link: ControllerLink) {}

  /** Merges into the frame that will go out on the next tick. */
  frame(patch: InputFrame): void {
    this.pending = { ...(this.pending ?? this.lastSent), ...patch };
    this.schedule();
  }

  /** Discrete events bypass the throttle: losing one would be felt. */
  act(action: ControllerAction): void {
    this.link.send({ t: 'act', e: action });
  }

  ready(on: boolean): void {
    this.link.send({ t: 'ready', on });
  }

  /** Forget the throttle state, e.g. when a new control scheme mounts. */
  reset(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.pending = null;
    this.lastSent = {};
    this.lastSentAt = 0;
  }

  private schedule(): void {
    if (this.timer) return;
    const wait = Math.max(0, MIN_INTERVAL - (performance.now() - this.lastSentAt));
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.flush();
    }, wait);
  }

  private flush(): void {
    const frame = this.pending;
    this.pending = null;
    if (!frame || !changed(this.lastSent, frame)) return;
    this.lastSent = frame;
    this.lastSentAt = performance.now();
    this.link.send({ t: 'input', f: frame });
  }
}

function changed(previous: InputFrame, next: InputFrame): boolean {
  if ((previous.b ?? 0) !== (next.b ?? 0)) return true;
  return (
    Math.abs((previous.x ?? 0) - (next.x ?? 0)) > AXIS_EPSILON ||
    Math.abs((previous.y ?? 0) - (next.y ?? 0)) > AXIS_EPSILON ||
    Math.abs((previous.p ?? 0) - (next.p ?? 0)) > AXIS_EPSILON ||
    Math.abs((previous.a ?? 0) - (next.a ?? 0)) > AXIS_EPSILON
  );
}
