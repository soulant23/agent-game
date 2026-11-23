import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';
import {
  CHAT_LIMIT,
  CHAT_WINDOW_MS,
  MAX_MESSAGES_PER_SECOND,
  MAX_MESSAGE_BYTES,
  TICK_INTERVAL_MS,
  type ErrorCode,
  type ServerMessage,
} from './messages.js';
import { Room } from './room.js';
import { parseClientMessage } from './validate.js';

const DIST_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(DIST_DIR, '../public');
const RATE_LIMIT_WINDOW_MS = 1000;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export interface RunningServer {
  server: Server;
  wss: WebSocketServer;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(port = 0): Promise<RunningServer> {
  const room = new Room();
  const httpServer = createServer((request, response) => {
    void serveStaticFile(request.url ?? '/', response);
  });
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

  const broadcastRoom = (message: ServerMessage): void => {
    const payload = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN && room.has(client)) client.send(payload);
    }
  };

  let tick = 0;
  const tickTimer = setInterval(() => {
    tick += 1;
    broadcastRoom({ type: 'positions', tick, players: room.positions() });
  }, TICK_INTERVAL_MS);

  wss.on('connection', (socket) => {
    socket.on('error', () => {});

    let rateWindowStartedAt = Date.now();
    let messageCount = 0;
    let lastRateLimitErrorAt = -Infinity;
    let chatWindowStartedAt = Date.now();
    let chatCount = 0;

    socket.on('message', (raw, isBinary) => {
      const now = Date.now();
      if (now - rateWindowStartedAt >= RATE_LIMIT_WINDOW_MS) {
        rateWindowStartedAt = now;
        messageCount = 0;
      }
      messageCount += 1;
      if (messageCount > MAX_MESSAGES_PER_SECOND) {
        if (now - lastRateLimitErrorAt >= RATE_LIMIT_WINDOW_MS) {
          sendError(socket, 'rate_limited', 'Message rate limit exceeded.');
          lastRateLimitErrorAt = now;
        }
        return;
      }

      if (isBinary) {
        sendError(socket, 'invalid_message', 'Text messages only.');
        return;
      }

      const parsed = parseClientMessage(raw.toString());
      if (!parsed.ok) {
        sendError(socket, parsed.code, parsed.message);
        return;
      }

      if (parsed.message.type === 'join') {
        if (room.has(socket)) {
          sendError(socket, 'already_joined', 'You have already joined the room.');
          return;
        }
        const { displayName } = parsed.message;
        if (room.hasDisplayName(displayName)) {
          sendError(socket, 'duplicate_display_name', `Display name "${displayName}" is already taken.`);
          return;
        }

        room.add(socket, displayName, now);
        send(socket, { type: 'joined', displayName, participants: room.participants });
        send(socket, { type: 'snapshot', players: room.positions() });
        broadcastRoom({ type: 'presence', participants: room.participants });
        return;
      }

      if (!room.has(socket)) {
        sendError(socket, 'not_joined', 'Join before sending messages.');
        return;
      }

      if (parsed.message.type === 'chat') {
        if (now - chatWindowStartedAt >= CHAT_WINDOW_MS) {
          chatWindowStartedAt = now;
          chatCount = 0;
        }
        if (chatCount >= CHAT_LIMIT) {
          sendError(socket, 'rate_limited', 'Chat rate limit exceeded.');
          return;
        }
        chatCount += 1;

        const displayName = room.displayNameOf(socket);
        if (displayName === undefined) {
          sendError(socket, 'not_joined', 'Join before sending messages.');
          return;
        }
        broadcastRoom({
          type: 'chat',
          displayName,
          text: parsed.message.text,
          timestamp: now,
        });
        return;
      }

      const outcome = room.applyMove(socket, parsed.message.dx, parsed.message.dy, now);
      if (!outcome.ok) sendError(socket, outcome.code, 'Join before sending messages.');
    });

    socket.on('close', () => {
      if (!room.has(socket)) return;
      room.remove(socket);
      broadcastRoom({ type: 'presence', participants: room.participants });
    });
  });

  await listen(httpServer, port);
  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    server: httpServer,
    wss,
    port: boundPort,
    close: async () => {
      clearInterval(tickTimer);
      for (const client of wss.clients) client.terminate();
      await closeWebSocketServer(wss);
      await closeHttpServer(httpServer);
    },
  };
}

async function serveStaticFile(url: string, response: ServerResponse): Promise<void> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = resolve(PUBLIC_DIR, `.${pathname}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const content = await readFile(filePath);
    const contentType = CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
  send(socket, { type: 'error', code, message });
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    wss.close((error) => (error ? reject(error) : resolve()));
  });
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const rawPort = process.env.PORT;
  const port = rawPort === undefined ? 3000 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('PORT must be an integer between 0 and 65535.');
    process.exitCode = 1;
  } else {
    startServer(port)
      .then(({ port: boundPort }) => {
        console.log(`Virtual Room listening on http://localhost:${boundPort}`);
      })
      .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
