import type {
  HostToController,
  HudState,
  MinigameMeta,
  PlayerIdentity,
  TowerSnapshot,
} from '@topple/shared';
import type { InputSender } from '../input/sender.js';

export interface SchemeContext {
  /** The scheme owns this element completely and may replace its contents. */
  root: HTMLElement;
  send: InputSender;
  identity: PlayerIdentity;
  /** Metadata for the running minigame, if the host named one. */
  meta: MinigameMeta | null;
  /** Set only when the host opened the tower, carrying the saved state. */
  jenga?: { pulls: number; snapshot?: TowerSnapshot };
  /** Reports a resolved pull (or a collapse) back to the host. */
  reportTower?(report: {
    blocks: number;
    collapsed: boolean;
    snapshot: TowerSnapshot;
    pullsLeft: number;
  }): void;
  /** Streams live tower transforms for the TV mirror. */
  streamTower?(snapshot: TowerSnapshot): void;
  haptic(pattern: number[]): void;
  toast(text: string): void;
}

/**
 * A control surface. Schemes are per-feel, not per-minigame, so two games that
 * want a stick and a button share one implementation and one set of bugs.
 */
export interface ControlScheme {
  mount(): void | Promise<void>;
  unmount(): void;
  onHud?(hud: HudState): void;
  /** Only the tower scheme needs raw host traffic; the rest ignore this. */
  onHostMessage?(message: HostToController): void;
}

export type SchemeFactory = (ctx: SchemeContext) => ControlScheme;

/** Small helper so schemes can build DOM without a framework. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
