import './style.css';
import {
  MINIGAMES,
  TOTAL_BLOCKS,
  type HostToController,
  type HudState,
  type MinigameMeta,
  type PlayerIdentity,
  type TowerSnapshot,
} from '@topple/shared';
import { ControllerLink } from './net/link.js';
import { InputSender } from './input/sender.js';
import { SCHEMES } from './schemes/registry.js';
import { el, type ControlScheme, type SchemeContext } from './schemes/types.js';
import { joinScreen, type JoinScreenHandle } from './screens/join.js';
import { gameOverScreen, readyScreen, resultScreen, spectatorScreen } from './screens/cards.js';

/**
 * The controller is a router and nothing else: the host says which surface to
 * show, this mounts it, and the surface owns its own DOM until it is replaced.
 *
 * Keeping the phone dumb is what makes adding a minigame a host-only change.
 */
class ControllerApp {
  private readonly root: HTMLElement;
  private readonly bar = el('div', 'bar');
  private readonly surface = el('div', 'surface');
  private readonly link = new ControllerLink();
  private readonly sender = new InputSender(this.link);

  private current: ControlScheme | null = null;
  private join: JoinScreenHandle | null = null;
  private identity: PlayerIdentity | null = null;
  private hud: HudState | null = null;
  private meta: MinigameMeta | null = null;
  private eliminated = false;
  private wakeLock: WakeLockSentinel | null = null;

  constructor(root: HTMLElement) {
    this.root = root;

    this.link.on('identity', (you) => {
      this.identity = you;
      this.eliminated = false;
      this.paintBar();
      this.showJoinedShell();
      this.mount(readyScreen(this.context(), (on) => this.sender.ready(on)));
      void this.keepAwake();
    });

    this.link.on('state', (state, detail) => {
      if (state === 'rejected') {
        this.showJoin(detail ?? 'That did not work.');
      } else if (state === 'lost') {
        this.toast('Reconnecting...');
      } else if (state === 'connecting') {
        this.join?.setBusy(true);
      }
    });

    this.link.on('host', (message) => this.onHost(message));

    // Phones lock, tabs reload, browsers get backgrounded. If this phone
    // already holds a seat, go straight back to it instead of making the
    // player retype a code mid-party.
    const resume = this.link.resumable();
    if (resume) {
      this.showResuming();
      this.link.join(resume.code, resume.name);
    } else {
      this.showJoin();
    }
  }

  /** Shown for the moment between a reload and the seat coming back. */
  private showResuming(): void {
    const card = el('div', 'center-card');
    card.append(el('h1', 'big', 'RECONNECTING'), el('p', 'dim', 'Getting you back into the game...'));
    this.root.replaceChildren(card);
  }

  /* ------------------------------------------------------------ *
   * Shell
   * ------------------------------------------------------------ */

  private showJoin(error = ''): void {
    this.unmountCurrent();
    this.join = joinScreen({
      initialCode: ControllerLink.codeFromUrl(),
      initialName: this.link.name,
      onSubmit: (code, name) => {
        this.join?.setError('');
        this.join?.setBusy(true);
        this.link.join(code, name);
      },
    });
    if (error) this.join.setError(error);
    this.join.setBusy(false);
    this.root.replaceChildren(this.join.element);
  }

  private showJoinedShell(): void {
    this.join = null;
    this.root.replaceChildren(this.bar, this.surface);
  }

  private paintBar(): void {
    if (!this.identity) return;
    const blocks = this.hud?.blocks ?? TOTAL_BLOCKS;
    const place = this.hud?.place;

    this.bar.replaceChildren();
    const who = el('div', 'who');
    const dot = el('span', 'dot');
    dot.style.background = this.identity.color;
    dot.style.boxShadow = '0 0 10px ' + this.identity.color;
    who.append(dot, el('span', '', this.identity.name));

    const stat = el('div', 'stat');
    const blockLine = el('b', '', blocks + ' blocks');
    stat.append(blockLine);
    stat.append(
      el(
        'span',
        '',
        this.eliminated ? 'eliminated' : place ? 'place ' + place + ' of ' + (this.hud?.alive ?? '?') : 'tower intact',
      ),
    );

    this.bar.append(who, el('div', 'spacer'), stat);
  }

  /* ------------------------------------------------------------ *
   * Routing
   * ------------------------------------------------------------ */

  private context(extras: Partial<SchemeContext> = {}): SchemeContext {
    const identity = this.identity;
    if (!identity) throw new Error('no identity yet');
    return {
      root: this.surface,
      send: this.sender,
      identity,
      meta: this.meta,
      haptic: (pattern) => this.vibrate(pattern),
      toast: (text) => this.toast(text),
      streamTower: (snapshot: TowerSnapshot) => this.link.send({ t: 'towerFrame', snap: snapshot }),
      reportTower: (report) =>
        this.link.send({
          t: 'towerState',
          blocks: report.blocks,
          collapsed: report.collapsed,
          snap: report.snapshot,
          pullsLeft: report.pullsLeft,
        }),
      ...extras,
    };
  }

  private mount(scheme: ControlScheme): void {
    this.unmountCurrent();
    this.current = scheme;
    this.sender.reset();
    void scheme.mount();
  }

  private unmountCurrent(): void {
    this.current?.unmount();
    this.current = null;
  }

  private onHost(message: HostToController): void {
    switch (message.t) {
      case 'hello':
        this.identity = message.you;
        this.hud = message.hud;
        this.paintBar();
        return;

      case 'hud':
        this.hud = message.hud;
        this.paintBar();
        this.current?.onHud?.(message.hud);
        return;

      case 'scheme': {
        this.meta = message.game ? MINIGAMES[message.game] : null;
        // An eliminated player watches; they keep getting hud updates but no
        // controls, so a dead phone can never influence a live round.
        const id = this.eliminated ? 'idle' : message.scheme;
        const factory = SCHEMES[id] ?? SCHEMES.idle;
        this.mount(factory(this.context()));
        return;
      }

      case 'result':
        this.vibrate(message.place === 1 ? [40, 60, 40] : [90]);
        this.mount(
          resultScreen(this.context(), {
            place: message.place,
            of: message.of,
            pulls: message.pulls,
            ...(message.scoreLine ? { scoreLine: message.scoreLine } : {}),
          }),
        );
        return;

      case 'jenga':
        this.mount(
          SCHEMES.jenga(
            this.context({
              jenga: {
                pulls: message.pulls,
                ...(message.snapshot ? { snapshot: message.snapshot } : {}),
              },
            }),
          ),
        );
        return;

      case 'jengaClose':
        this.mount(SCHEMES.idle(this.context()));
        return;

      case 'toast':
        this.toast(message.text);
        return;

      case 'haptic':
        this.vibrate(message.pattern);
        return;

      case 'eliminated':
        this.eliminated = true;
        this.paintBar();
        this.mount(spectatorScreen(this.context()));
        return;

      case 'gameOver':
        this.mount(gameOverScreen(this.context(), message.winner, message.yourPlace));
        return;
    }
  }

  /* ------------------------------------------------------------ *
   * Device niceties
   * ------------------------------------------------------------ */

  private vibrate(pattern: number[]): void {
    if (!('vibrate' in navigator)) return;
    // Never trust a length off the wire with the device's motor.
    const safe = pattern.slice(0, 8).map((ms) => Math.min(Math.max(Math.round(ms), 0), 400));
    try {
      navigator.vibrate(safe);
    } catch {
      /* some browsers throw when the page is backgrounded */
    }
  }

  private toast(text: string): void {
    const node = el('div', 'toast-mini', text);
    this.surface.append(node);
    setTimeout(() => node.remove(), 2500);
  }

  /** Phones sleeping mid-round is the single most annoying party-game bug. */
  private async keepAwake(): Promise<void> {
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.wakeLock?.released !== false) {
          void this.keepAwake();
        }
      });
    } catch {
      /* denied or unsupported; not worth telling the player about */
    }
  }
}

const mount = document.getElementById('app');
if (mount) new ControllerApp(mount);
