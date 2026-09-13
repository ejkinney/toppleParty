import { randomUUID } from 'node:crypto';
import {
  BALANCE,
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_PLAYERS,
  sanitiseName,
  seatColor,
  seatShape,
  type ControllerToHost,
  type HostToController,
  type JoinRejection,
  type PlayerId,
  type PlayerIdentity,
  type RoomCode,
  type ServerToController,
  type ServerToHost,
} from '@topple/shared';
import { log } from './log.js';

/** Everything rooms need from a transport. Keeps ws out of the game layer. */
export interface Socket {
  send(payload: string): void;
  close(): void;
}

export interface RoomPlayer {
  identity: PlayerIdentity;
  /** Secret the phone stores so a refresh or a tunnel blip keeps the seat. */
  token: string;
  socket: Socket | null;
  offlineSince: number | null;
}

export type JoinResult =
  | { ok: true; room: Room; player: RoomPlayer; resumed: boolean }
  | { ok: false; reason: JoinRejection; message: string };

const REJECTION_TEXT: Record<JoinRejection, string> = {
  'no-such-room': 'No game with that code. Check the TV.',
  'room-full': 'That game is full.',
  'room-locked': 'That game already started.',
  'name-taken': 'Someone here already has that name.',
  'bad-version': 'Your controller is out of date. Reload the page.',
};

export class Room {
  readonly players = new Map<PlayerId, RoomPlayer>();
  locked = false;
  readonly createdAt = Date.now();

  constructor(
    readonly code: RoomCode,
    public host: Socket | null,
    readonly joinUrl: string,
  ) {}

  toHost(message: ServerToHost): void {
    this.host?.send(JSON.stringify(message));
  }

  toPlayer(id: PlayerId, message: ServerToController): void {
    this.players.get(id)?.socket?.send(JSON.stringify(message));
  }

  broadcast(message: ServerToController): void {
    const payload = JSON.stringify(message);
    for (const player of this.players.values()) player.socket?.send(payload);
  }

  /** Serialising once and reusing the string is the whole point of this method. */
  relayFromHost(to: PlayerId | '*', message: HostToController): void {
    const payload = JSON.stringify({ t: 'fromHost', m: message } satisfies ServerToController);
    if (to === '*') {
      for (const player of this.players.values()) player.socket?.send(payload);
    } else {
      this.players.get(to)?.socket?.send(payload);
    }
  }

  relayToHost(from: PlayerId, message: ControllerToHost): void {
    this.toHost({ t: 'fromPlayer', from, m: message });
  }

  freeSeat(): number | null {
    const taken = new Set<number>();
    for (const player of this.players.values()) taken.add(player.identity.seat);
    for (let seat = 0; seat < MAX_PLAYERS; seat++) if (!taken.has(seat)) return seat;
    return null;
  }
}

export class RoomRegistry {
  private readonly rooms = new Map<RoomCode, Room>();
  private readonly byToken = new Map<string, { code: RoomCode; id: PlayerId }>();

  constructor(private readonly resolveJoinUrl: (code: RoomCode) => string) {}

  get size(): number {
    return this.rooms.size;
  }

  get(code: RoomCode): Room | undefined {
    return this.rooms.get(code);
  }

  create(host: Socket): Room {
    const code = this.allocateCode();
    const room = new Room(code, host, this.resolveJoinUrl(code));
    this.rooms.set(code, room);
    log.info('room ' + code + ' opened (' + this.rooms.size + ' live)');
    return room;
  }

  join(
    room: Room | undefined,
    rawName: string,
    token: string | undefined,
    socket: Socket,
  ): JoinResult {
    if (!room) return this.reject('no-such-room');

    // Reconnect path: an existing seat wins over every other rule, including
    // the lock, so a dropped phone can always get back into a running game.
    const claim = token ? this.byToken.get(token) : undefined;
    if (claim && claim.code === room.code) {
      const existing = room.players.get(claim.id);
      if (existing) {
        existing.socket?.close();
        existing.socket = socket;
        existing.offlineSince = null;
        const name = sanitiseName(rawName);
        if (name !== 'PLAYER') existing.identity = { ...existing.identity, name };
        return { ok: true, room, player: existing, resumed: true };
      }
    }

    if (room.locked) return this.reject('room-locked');
    const seat = room.freeSeat();
    if (seat === null) return this.reject('room-full');

    const name = sanitiseName(rawName);
    for (const player of room.players.values()) {
      if (player.identity.name === name) return this.reject('name-taken');
    }

    const id: PlayerId = 'p_' + randomUUID().slice(0, 8);
    const freshToken = randomUUID();
    const player: RoomPlayer = {
      identity: { id, name, seat, color: seatColor(seat), shape: seatShape(seat) },
      token: freshToken,
      socket,
      offlineSince: null,
    };
    room.players.set(id, player);
    this.byToken.set(freshToken, { code: room.code, id });
    log.info('room ' + room.code + ': ' + name + ' took seat ' + seat);
    return { ok: true, room, player, resumed: false };
  }

  /**
   * Socket dropped. The seat is held so the player can walk back into the game.
   *
   * `socket` is the one that closed. A fast reconnect replaces the seat's
   * socket before the old one's close event lands, so a close from a socket the
   * seat has already moved on from must be ignored - otherwise the player is
   * marked offline milliseconds after successfully rejoining.
   */
  markOffline(room: Room, id: PlayerId, socket: Socket): void {
    const player = room.players.get(id);
    if (!player || player.socket !== socket) return;
    player.socket = null;
    player.offlineSince = Date.now();
    room.toHost({ t: 'playerOffline', player: id });
  }

  removePlayer(room: Room, id: PlayerId, reason: 'quit' | 'timeout' | 'kicked'): void {
    const player = room.players.get(id);
    if (!player) return;
    room.players.delete(id);
    this.byToken.delete(player.token);
    player.socket?.close();
    room.toHost({ t: 'playerLeft', player: id, reason });
    log.info('room ' + room.code + ': ' + player.identity.name + ' left (' + reason + ')');
  }

  closeRoom(room: Room): void {
    room.broadcast({ t: 'hostLost' });
    for (const player of room.players.values()) {
      this.byToken.delete(player.token);
      player.socket?.close();
    }
    room.players.clear();
    room.host = null;
    this.rooms.delete(room.code);
    log.info('room ' + room.code + ' closed (' + this.rooms.size + ' live)');
  }

  /** Called on a timer: evicts phones that never came back. */
  sweep(now = Date.now()): void {
    for (const room of this.rooms.values()) {
      for (const [id, player] of room.players) {
        if (player.offlineSince === null) continue;
        if (now - player.offlineSince > BALANCE.RECONNECT_GRACE_MS) {
          this.removePlayer(room, id, 'timeout');
        }
      }
    }
  }

  private reject(reason: JoinRejection): JoinResult {
    return { ok: false, reason, message: REJECTION_TEXT[reason] };
  }

  private allocateCode(): RoomCode {
    for (let attempt = 0; attempt < 500; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('room code space exhausted');
  }
}
