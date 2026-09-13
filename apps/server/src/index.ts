import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  BALANCE,
  PROTOCOL_VERSION,
  decode,
  isRoomCode,
  normaliseCode,
  type ControllerToServer,
  type HostToServer,
  type PlayerId,
  type RoomCode,
  type ServerToController,
  type ServerToHost,
} from '@topple/shared';
import { config, joinBase } from './config.js';
import { log } from './log.js';
import { Room, RoomRegistry, type Socket } from './rooms.js';
import { serveStatic } from './static.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const HOST_DIST = resolve(repoRoot, 'apps/host/dist');
const CONTROLLER_DIST = resolve(repoRoot, 'apps/controller/dist');

const rooms = new RoomRegistry((code) => joinBase() + '/?c=' + code);

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

const httpServer = createServer((req, res) => {
  void handleHttp(req, res).catch((error: unknown) => {
    log.error('http: ' + String(error));
    if (!res.headersSent) res.writeHead(500);
    res.end('server error');
  });
});

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://' + (req.headers.host ?? 'localhost'));
  const path = url.pathname;

  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, join: joinBase() }));
    return;
  }

  if (config.dev) {
    // Vite owns the pages in dev; we only answer the API and the socket.
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('dev mode: open the Vite host at /host from the terminal banner');
    return;
  }

  // The host bundle uses relative asset paths, so it must be served from a
  // directory URL or './assets/...' resolves against the site root.
  if (path === '/host') {
    res.writeHead(301, { location: '/host/' });
    res.end();
    return;
  }

  const served =
    path.startsWith('/host/')
      ? await serveStatic(req, res, HOST_DIST, '/host', path)
      : await serveStatic(req, res, CONTROLLER_DIST, '', path);
  if (!served) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

/* ------------------------------------------------------------------ *
 * WebSocket
 * ------------------------------------------------------------------ */

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 256 * 1024 });

/** What a live socket is doing right now. Set on its first message. */
type Role =
  | { kind: 'pending' }
  | { kind: 'host'; room: Room }
  | { kind: 'player'; room: Room; id: PlayerId; socket: Socket };

const roles = new WeakMap<WebSocket, Role>();
const alive = new WeakSet<WebSocket>();

function wrap(ws: WebSocket): Socket {
  return {
    send(payload) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    },
    close() {
      try {
        ws.close();
      } catch {
        /* already gone */
      }
    },
  };
}

wss.on('connection', (ws) => {
  roles.set(ws, { kind: 'pending' });
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));

  ws.on('message', (raw) => {
    const role = roles.get(ws) ?? { kind: 'pending' };
    const text = typeof raw === 'string' ? raw : raw.toString();
    if (role.kind === 'host') return onHostMessage(role.room, text);
    if (role.kind === 'player') return onPlayerMessage(role.room, role.id, text);
    return onFirstMessage(ws, text);
  });

  ws.on('close', () => {
    const role = roles.get(ws);
    roles.delete(ws);
    if (!role) return;
    if (role.kind === 'host') {
      rooms.closeRoom(role.room);
    } else if (role.kind === 'player') {
      rooms.markOffline(role.room, role.id, role.socket);
    }
  });

  ws.on('error', (error) => log.warn('socket: ' + error.message));
});

function reply(ws: WebSocket, message: ServerToController | ServerToHost): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

/** The first frame decides whether this socket is a TV or a phone. */
function onFirstMessage(ws: WebSocket, text: string): void {
  const message = decode<HostToServer | ControllerToServer>(text);
  if (!message) return;

  if (message.t === 'createRoom') {
    if (message.v !== PROTOCOL_VERSION) {
      reply(ws, { t: 'error', message: 'protocol mismatch, rebuild the host' });
      ws.close();
      return;
    }
    const room = rooms.create(wrap(ws));
    roles.set(ws, { kind: 'host', room });
    reply(ws, { t: 'room', code: room.code, joinUrl: room.joinUrl });
    return;
  }

  if (message.t === 'join') {
    if (message.v !== PROTOCOL_VERSION) {
      reply(ws, { t: 'rejected', reason: 'bad-version', message: 'Reload this page.' });
      return;
    }
    const code = normaliseCode(message.code);
    const room = isRoomCode(code) ? rooms.get(code as RoomCode) : undefined;
    // One wrapper per socket, kept in the role, so a close event can prove it
    // belongs to the socket the seat currently holds.
    const socket = wrap(ws);
    const result = rooms.join(room, message.name, message.token, socket);
    if (!result.ok) {
      reply(ws, { t: 'rejected', reason: result.reason, message: result.message });
      return;
    }
    roles.set(ws, { kind: 'player', room: result.room, id: result.player.identity.id, socket });
    reply(ws, {
      t: 'joined',
      you: result.player.identity,
      token: result.player.token,
      code: result.room.code,
    });
    result.room.toHost({
      t: 'playerJoined',
      player: result.player.identity,
      resumed: result.resumed,
    });
    return;
  }

  log.debug('ignored pre-handshake frame: ' + text.slice(0, 80));
}

function onHostMessage(room: Room, text: string): void {
  const message = decode<HostToServer>(text);
  if (!message) return;
  switch (message.t) {
    case 'toPlayer':
      room.relayFromHost(message.to, message.m);
      return;
    case 'lock':
      room.locked = message.on;
      return;
    case 'kick':
      rooms.removePlayer(room, message.player, 'kicked');
      return;
    default:
      return;
  }
}

function onPlayerMessage(room: Room, id: PlayerId, text: string): void {
  const message = decode<ControllerToServer>(text);
  if (!message) return;
  if (message.t === 'toHost') room.relayToHost(id, message.m);
}

/* ------------------------------------------------------------------ *
 * Timers and lifecycle
 * ------------------------------------------------------------------ */

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
  rooms.sweep();
}, BALANCE.HEARTBEAT_MS);
heartbeat.unref?.();

httpServer.listen(config.port, config.host, () => {
  const base = joinBase();
  log.info('topple party server listening on :' + config.port);
  log.info('  phones join at  ' + base + '/?c=CODE');
  log.info(config.dev ? '  host (dev)      http://localhost:5173/' : '  host display    ' + base + '/host');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('shutting down');
    clearInterval(heartbeat);
    wss.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
