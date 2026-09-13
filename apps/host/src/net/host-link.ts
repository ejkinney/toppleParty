import {
  PROTOCOL_VERSION,
  decode,
  type ControllerToHost,
  type HostToController,
  type HostToServer,
  type PlayerId,
  type PlayerIdentity,
  type RoomCode,
  type ServerToHost,
} from '@topple/shared';

export interface HostLinkEvents {
  room(code: RoomCode, joinUrl: string): void;
  playerJoined(player: PlayerIdentity, resumed: boolean): void;
  playerOffline(player: PlayerId): void;
  playerLeft(player: PlayerId, reason: string): void;
  message(from: PlayerId, message: ControllerToHost): void;
  status(state: 'connecting' | 'open' | 'closed'): void;
}

/** Where the relay lives. In dev Vite serves the page, so the port differs. */
function serverUrl(): string {
  const override = import.meta.env['VITE_SERVER_URL'] as string | undefined;
  if (override) return override;
  const secure = location.protocol === 'https:';
  const scheme = secure ? 'wss:' : 'ws:';
  const port = import.meta.env.DEV ? (import.meta.env['VITE_SERVER_PORT'] ?? '3000') : location.port;
  const authority = port ? location.hostname + ':' + port : location.hostname;
  return scheme + '//' + authority + '/ws';
}

/**
 * The host's end of the relay. It reconnects on its own, but a dropped host
 * socket also means a dropped room, so the UI surfaces the state rather than
 * pretending the party is still running.
 */
export class HostLink {
  private socket: WebSocket | null = null;
  private readonly handlers: Partial<HostLinkEvents> = {};
  private reconnectDelay = 500;

  code: RoomCode | null = null;
  joinUrl = '';

  private announceRoom: (() => void) | null = null;
  /** Resolves the first time the relay hands us a room code. */
  readonly opened = new Promise<void>((resolve) => {
    this.announceRoom = resolve;
  });

  on<K extends keyof HostLinkEvents>(event: K, handler: HostLinkEvents[K]): void {
    this.handlers[event] = handler;
  }

  connect(): void {
    this.handlers.status?.('connecting');
    const socket = new WebSocket(serverUrl());
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.reconnectDelay = 500;
      this.handlers.status?.('open');
      this.send({ t: 'createRoom', v: PROTOCOL_VERSION });
    });

    socket.addEventListener('message', (event) => {
      const message = decode<ServerToHost>(String(event.data));
      if (message) this.dispatch(message);
    });

    socket.addEventListener('close', () => {
      this.handlers.status?.('closed');
      this.socket = null;
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 8000);
    });

    socket.addEventListener('error', () => socket.close());
  }

  private dispatch(message: ServerToHost): void {
    switch (message.t) {
      case 'room':
        this.code = message.code;
        this.joinUrl = message.joinUrl;
        this.announceRoom?.();
        this.announceRoom = null;
        this.handlers.room?.(message.code, message.joinUrl);
        return;
      case 'playerJoined':
        this.handlers.playerJoined?.(message.player, message.resumed);
        return;
      case 'playerOffline':
        this.handlers.playerOffline?.(message.player);
        return;
      case 'playerLeft':
        this.handlers.playerLeft?.(message.player, message.reason);
        return;
      case 'fromPlayer':
        this.handlers.message?.(message.from, message.m);
        return;
      case 'error':
        console.warn('[relay]', message.message);
        return;
    }
  }

  private send(message: HostToServer): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  to(player: PlayerId, message: HostToController): void {
    this.send({ t: 'toPlayer', to: player, m: message });
  }

  all(message: HostToController): void {
    this.send({ t: 'toPlayer', to: '*', m: message });
  }

  lock(on: boolean): void {
    this.send({ t: 'lock', on });
  }

  kick(player: PlayerId): void {
    this.send({ t: 'kick', player });
  }
}
