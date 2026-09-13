import {
  PROTOCOL_VERSION,
  decode,
  type ControllerToHost,
  type ControllerToServer,
  type HostToController,
  type JoinRejection,
  type PlayerIdentity,
  type ServerToController,
} from '@topple/shared';

const TOKEN_KEY = 'topple.token';
const NAME_KEY = 'topple.name';
const CODE_KEY = 'topple.code';

export type LinkState = 'idle' | 'connecting' | 'joined' | 'rejected' | 'lost';

export interface LinkEvents {
  state(state: LinkState, detail?: string): void;
  identity(you: PlayerIdentity): void;
  host(message: HostToController): void;
}

function serverUrl(): string {
  const override = import.meta.env['VITE_SERVER_URL'] as string | undefined;
  if (override) return override;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = import.meta.env.DEV ? (import.meta.env['VITE_SERVER_PORT'] ?? '3000') : location.port;
  const authority = port ? location.hostname + ':' + port : location.hostname;
  return scheme + '//' + authority + '/ws';
}

/**
 * The phone's end of the relay.
 *
 * Reconnecting is the whole design here: phones lock, browsers background
 * tabs, and Wi-Fi drops. A resume token in localStorage means walking back in
 * restores the same seat, the same colour and the same tower, so a dropout
 * never costs a player their game.
 */
export class ControllerLink {
  private socket: WebSocket | null = null;
  private readonly handlers: Partial<LinkEvents> = {};
  private retryDelay = 400;
  private retryTimer = 0;
  private wantsConnection = false;

  code = '';
  name = '';
  you: PlayerIdentity | null = null;

  constructor() {
    this.name = localStorage.getItem(NAME_KEY) ?? '';
  }

  /** The room this phone was last in, so a reload knows where to go back to. */
  get lastCode(): string {
    return localStorage.getItem(CODE_KEY) ?? '';
  }

  /**
   * Everything needed to walk straight back into a game after a reload: a seat
   * token, the room it belongs to, and the name to reclaim. A scanned QR wins
   * over the remembered room, so pointing a phone at a new game still works.
   */
  resumable(): { code: string; name: string } | null {
    if (!this.token || !this.name) return null;
    const code = ControllerLink.codeFromUrl() || this.lastCode;
    return code ? { code, name: this.name } : null;
  }

  on<K extends keyof LinkEvents>(event: K, handler: LinkEvents[K]): void {
    this.handlers[event] = handler;
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  /** Codes arrive either from the QR (?c=ABCD) or from the keypad. */
  static codeFromUrl(): string {
    const params = new URLSearchParams(location.search);
    return (params.get('c') ?? params.get('code') ?? '').toUpperCase();
  }

  join(code: string, name: string): void {
    this.code = code;
    this.name = name;
    localStorage.setItem(NAME_KEY, name);
    this.wantsConnection = true;
    this.open();
  }

  /** Deliberate exit: forget the seat so the next join is a fresh player. */
  leave(): void {
    this.wantsConnection = false;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CODE_KEY);
    this.you = null;
    window.clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = null;
  }

  send(message: ControllerToHost): void {
    this.sendRaw({ t: 'toHost', m: message });
  }

  private sendRaw(message: ControllerToServer): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private open(): void {
    window.clearTimeout(this.retryTimer);
    this.handlers.state?.('connecting');

    const socket = new WebSocket(serverUrl());
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.retryDelay = 400;
      const token = this.token;
      this.sendRaw({
        t: 'join',
        v: PROTOCOL_VERSION,
        code: this.code,
        name: this.name,
        ...(token ? { token } : {}),
      });
    });

    socket.addEventListener('message', (event) => {
      const message = decode<ServerToController>(String(event.data));
      if (message) this.dispatch(message);
    });

    socket.addEventListener('close', () => {
      this.socket = null;
      if (!this.wantsConnection) return;
      this.handlers.state?.('lost');
      this.retryTimer = window.setTimeout(() => this.open(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 1.8, 6000);
    });

    socket.addEventListener('error', () => socket.close());
  }

  private dispatch(message: ServerToController): void {
    switch (message.t) {
      case 'joined':
        localStorage.setItem(TOKEN_KEY, message.token);
        localStorage.setItem(CODE_KEY, message.code);
        this.you = message.you;
        this.code = message.code;
        this.handlers.identity?.(message.you);
        this.handlers.state?.('joined');
        return;

      case 'rejected':
        // A stale token is the common case after a host restart: drop it so
        // the next attempt joins clean instead of looping on a dead seat.
        if (message.reason === ('no-such-room' satisfies JoinRejection)) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(CODE_KEY);
        }
        this.wantsConnection = false;
        this.handlers.state?.('rejected', message.message);
        return;

      case 'fromHost':
        this.handlers.host?.(message.m);
        return;

      case 'hostLost':
        this.wantsConnection = false;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(CODE_KEY);
        this.handlers.state?.('rejected', 'The game on the TV ended.');
        return;
    }
  }
}
