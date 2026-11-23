import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../dist/server.js';

let app;
const sockets = new Set();

before(async () => {
  app = await startServer(0);
});

after(async () => {
  for (const socket of sockets) socket.terminate();
  await app.close();
});

function openSocket() {
  const socket = new WebSocket(`ws://127.0.0.1:${app.port}`);
  sockets.add(socket);
  socket.on('error', () => {});
  socket.once('close', () => sockets.delete(socket));
  return socket;
}

function onceOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('open', onOpen);
      socket.off('error', onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    socket.once('open', onOpen);
    socket.once('error', onError);
  });
}

function waitForJoined(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for joined.'));
    }, 2000);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'joined') {
        cleanup();
        resolve(message);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

test('binds to all interfaces and accepts real WebSocket clients', async () => {
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  assert.equal(address.address, '0.0.0.0');

  const socket = openSocket();
  await onceOpen(socket);
  socket.send(JSON.stringify({ type: 'join', displayName: 'BindCheck' }));
  const joined = await waitForJoined(socket);
  assert.equal(joined.displayName, 'BindCheck');
  socket.close();
});
