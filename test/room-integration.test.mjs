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

async function openAndJoin(displayName) {
  const socket = openSocket();
  await onceOpen(socket);
  socket.send(JSON.stringify({ type: 'join', displayName }));
  const joined = await onceMessage(socket);
  return { socket, joined };
}

function onceOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = withTimeout(() => reject(new Error('Timed out waiting for open')));
    socket.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function onceMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = withTimeout(() => reject(new Error('Timed out waiting for message')));
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('message', onMessage);
    };
    const onMessage = (data) => {
      cleanup();
      resolve(JSON.parse(data.toString()));
    };
    socket.once('message', onMessage);
  });
}

function onceClose(socket) {
  return new Promise((resolve, reject) => {
    const timer = withTimeout(() => reject(new Error('Timed out waiting for close')));
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once('close', resolve);
    socket.close();
  });
}

function withTimeout(callback) {
  return setTimeout(callback, 2000);
}

test('joins a single room and broadcasts presence', async () => {
  const { socket: alice, joined } = await openAndJoin('Alice');
  assert.deepEqual(joined, {
    type: 'joined',
    displayName: 'Alice',
    participants: ['Alice'],
  });

  const presenceForAlice = onceMessage(alice);
  const { socket: bob, joined: bobJoined } = await openAndJoin('Bob');
  assert.deepEqual(bobJoined, {
    type: 'joined',
    displayName: 'Bob',
    participants: ['Alice', 'Bob'],
  });
  assert.deepEqual(await presenceForAlice, {
    type: 'presence',
    participants: ['Alice', 'Bob'],
  });

  const presenceAfterLeave = onceMessage(alice);
  await closeSocket(bob);
  assert.deepEqual(await presenceAfterLeave, {
    type: 'presence',
    participants: ['Alice'],
  });

  await closeSocket(alice);
});

test('rejects duplicate display names case-insensitively', async () => {
  const { socket: first } = await openAndJoin('Casey');
  const second = openSocket();
  await onceOpen(second);
  second.send(JSON.stringify({ type: 'join', displayName: 'casey' }));

  const error = await onceMessage(second);
  assert.equal(error.type, 'error');
  assert.equal(error.code, 'duplicate_display_name');

  await closeSocket(second);
  await closeSocket(first);
});

test('rejects empty and too-long display names', async () => {
  for (const displayName of ['   ', 'x'.repeat(21)]) {
    const socket = openSocket();
    await onceOpen(socket);
    socket.send(JSON.stringify({ type: 'join', displayName }));

    const error = await onceMessage(socket);
    assert.equal(error.type, 'error');
    assert.equal(error.code, 'invalid_display_name');

    await closeSocket(socket);
  }
});

test('rejects messages that are not join messages', async () => {
  const socket = openSocket();
  await onceOpen(socket);
  socket.send(JSON.stringify({ type: 'chat', text: 'hello' }));

  const error = await onceMessage(socket);
  assert.equal(error.type, 'error');
  assert.equal(error.code, 'invalid_message');

  await closeSocket(socket);
});

test('closes connections that exceed the message size limit', async () => {
  const socket = openSocket();
  await onceOpen(socket);
  const closed = onceClose(socket);
  socket.send(JSON.stringify({ type: 'join', displayName: 'x'.repeat(2048) }));

  assert.equal(await closed, 1009);
});
