import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../dist/server.js';

let app;
const sockets = new Set();
const SPAWN_X = 400;
const SPAWN_Y = 300;
const EDGE_X = 788;

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
  const joined = await waitForMessage(socket, (message) => message.type === 'joined');
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

function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (predicate(message)) {
        cleanup();
        resolve(message);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('message', onMessage);
    };
    const timer = withTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for message'));
    });
    socket.on('message', onMessage);
  });
}

function waitForPositions(socket, predicate = () => true) {
  return waitForMessage(socket, (message) => message.type === 'positions' && predicate(message));
}

function waitForError(socket, code) {
  return waitForMessage(socket, (message) => message.type === 'error' && message.code === code);
}

function waitForChat(socket, text) {
  return waitForMessage(
    socket,
    (message) => message.type === 'chat' && (text === undefined || message.text === text),
  );
}

async function collectMessages(socket, durationMs = 400) {
  const collected = [];
  const onMessage = (data) => collected.push(JSON.parse(data.toString()));
  socket.on('message', onMessage);
  await delay(durationMs);
  socket.off('message', onMessage);
  return collected;
}

function player(message, name) {
  return message.players.find((entry) => entry.displayName === name);
}

function assertPlayer(message, name) {
  const found = player(message, name);
  assert.ok(found, `${name} missing from message`);
  return found;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const presenceForAlice = waitForMessage(
    alice,
    (message) => message.type === 'presence' && message.participants.includes('Bob'),
  );
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

  const presenceAfterLeave = waitForMessage(
    alice,
    (message) => message.type === 'presence' && !message.participants.includes('Bob'),
  );
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

  const error = await waitForError(second, 'duplicate_display_name');
  assert.equal(error.type, 'error');

  await closeSocket(second);
  await closeSocket(first);
});

test('rejects empty and too-long display names', async () => {
  for (const displayName of ['   ', 'x'.repeat(21)]) {
    const socket = openSocket();
    await onceOpen(socket);
    socket.send(JSON.stringify({ type: 'join', displayName }));

    const error = await waitForError(socket, 'invalid_display_name');
    assert.equal(error.type, 'error');

    await closeSocket(socket);
  }
});

test('rejects messages that are not known message types', async () => {
  const socket = openSocket();
  await onceOpen(socket);
  socket.send(JSON.stringify({ type: 'dance', text: 'hello' }));

  const error = await waitForError(socket, 'invalid_message');
  assert.equal(error.type, 'error');

  await closeSocket(socket);
});

test('closes connections that exceed the message size limit', async () => {
  const socket = openSocket();
  await onceOpen(socket);
  const closed = onceClose(socket);
  socket.send(JSON.stringify({ type: 'join', displayName: 'x'.repeat(16_385) }));

  assert.equal(await closed, 1009);
});

test('broadcasts authoritative movement to all players', async () => {
  const { socket: alice } = await openAndJoin('MoverA');
  const { socket: bob } = await openAndJoin('MoverB');

  const baseline = await waitForPositions(bob, (message) => player(message, 'MoverA') !== undefined);
  const beforeX = assertPlayer(baseline, 'MoverA').x;
  await delay(60);

  const seenByAlice = waitForPositions(
    alice,
    (message) => (player(message, 'MoverA')?.x ?? 0) > beforeX,
  );
  const seenByBob = waitForPositions(
    bob,
    (message) => (player(message, 'MoverA')?.x ?? 0) > beforeX,
  );
  alice.send(JSON.stringify({ type: 'move', dx: 1, dy: 0 }));

  const [fromAlice, fromBob] = await Promise.all([seenByAlice, seenByBob]);
  assert.equal(assertPlayer(fromAlice, 'MoverA').x, assertPlayer(fromBob, 'MoverA').x);
  assert.ok(assertPlayer(fromBob, 'MoverA').x <= EDGE_X);

  await closeSocket(alice);
  await closeSocket(bob);
});

test('accepts normalized diagonal move intent', async () => {
  const { socket } = await openAndJoin('Diagonal');
  const baseline = await waitForPositions(socket, (message) => player(message, 'Diagonal') !== undefined);
  const start = assertPlayer(baseline, 'Diagonal');
  await delay(60);

  socket.send(JSON.stringify({ type: 'move', dx: Math.SQRT1_2, dy: Math.SQRT1_2 }));
  const moved = await waitForPositions(socket, (message) => {
    const current = player(message, 'Diagonal');
    return current !== undefined && current.x > start.x && current.y > start.y;
  });

  assert.ok(assertPlayer(moved, 'Diagonal').x > start.x);
  assert.ok(assertPlayer(moved, 'Diagonal').y > start.y);

  await closeSocket(socket);
});

test('clamps movement to the valid world bounds', async () => {
  const { socket } = await openAndJoin('Clampy');
  await waitForPositions(socket, (message) => player(message, 'Clampy') !== undefined);

  const errors = [];
  const onMessage = (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'error') errors.push(message.code);
  };
  socket.on('message', onMessage);

  for (let index = 0; index < 22; index += 1) {
    socket.send(JSON.stringify({ type: 'move', dx: 1, dy: 0 }));
    await delay(100);
  }

  const atEdge = await waitForPositions(
    socket,
    (message) => player(message, 'Clampy')?.x === EDGE_X,
  );
  assert.equal(assertPlayer(atEdge, 'Clampy').x, EDGE_X);
  assert.ok(!errors.includes('move_out_of_bounds'));

  await closeSocket(socket);
});

test('rejects excessive move magnitude without changing position', async () => {
  const { socket } = await openAndJoin('Fast');
  try {
    const baseline = await waitForPositions(socket, (message) => player(message, 'Fast') !== undefined);
    const startX = assertPlayer(baseline, 'Fast').x;

    socket.send(JSON.stringify({ type: 'move', dx: 2, dy: 0 }));
    await waitForError(socket, 'invalid_move_magnitude');
    socket.send(JSON.stringify({ type: 'move', dx: 1, dy: 1 }));
    await waitForError(socket, 'invalid_move_magnitude');
    const after = await waitForPositions(socket);

    assert.equal(assertPlayer(after, 'Fast').x, startX);
  } finally {
    await closeSocket(socket);
  }
});

test('sends a position snapshot to new joiners', async () => {
  const { socket: alice } = await openAndJoin('SnapshotA');
  await waitForPositions(alice, (message) => player(message, 'SnapshotA') !== undefined);
  await delay(60);
  alice.send(JSON.stringify({ type: 'move', dx: 1, dy: 0 }));
  const moved = await waitForPositions(
    alice,
    (message) => (player(message, 'SnapshotA')?.x ?? 0) > SPAWN_X,
  );
  const aliceX = assertPlayer(moved, 'SnapshotA').x;

  const bob = openSocket();
  await onceOpen(bob);
  bob.send(JSON.stringify({ type: 'join', displayName: 'SnapshotB' }));
  const snapshot = await waitForMessage(bob, (message) => message.type === 'snapshot');

  assert.equal(assertPlayer(snapshot, 'SnapshotA').x, aliceX);
  assert.equal(assertPlayer(snapshot, 'SnapshotB').x, SPAWN_X);
  assert.equal(assertPlayer(snapshot, 'SnapshotB').y, SPAWN_Y);

  await closeSocket(bob);
  await closeSocket(alice);
});

test('removes disconnected players from position broadcasts', async () => {
  const { socket: alice } = await openAndJoin('Stay');
  const { socket: bob } = await openAndJoin('Leave');
  await waitForPositions(alice, (message) => player(message, 'Leave') !== undefined);

  const afterLeave = waitForPositions(
    alice,
    (message) => player(message, 'Leave') === undefined && player(message, 'Stay') !== undefined,
  );
  await closeSocket(bob);
  const positions = await afterLeave;

  assert.equal(positions.players.length, 1);
  assert.equal(assertPlayer(positions, 'Stay').displayName, 'Stay');
  await closeSocket(alice);
});

test('rate limits excessive messages and sends at most one error per second', async () => {
  const { socket } = await openAndJoin('RateLimited');
  const errors = [];
  const onMessage = (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'error' && message.code === 'rate_limited') errors.push(message);
  };
  socket.on('message', onMessage);

  for (let index = 0; index < 70; index += 1) {
    socket.send(JSON.stringify({ type: 'move', dx: 0, dy: 0 }));
  }
  await delay(200);
  socket.off('message', onMessage);

  assert.equal(errors.length, 1);
  await closeSocket(socket);
});

test('broadcasts chat to everyone including the sender', async () => {
  const { socket: alice } = await openAndJoin('ChatAlice');
  const { socket: bob } = await openAndJoin('ChatBob');
  try {
    const toAlice = waitForChat(alice, 'hello room');
    const toBob = waitForChat(bob, 'hello room');
    alice.send(JSON.stringify({ type: 'chat', text: '  hello room  ' }));

    const [fromAlice, fromBob] = await Promise.all([toAlice, toBob]);
    assert.deepEqual(fromAlice, fromBob);
    assert.equal(fromAlice.displayName, 'ChatAlice');
    assert.equal(fromAlice.text, 'hello room');
    assert.equal(typeof fromAlice.timestamp, 'number');
    assert.ok(fromAlice.timestamp > 0);
  } finally {
    await closeSocket(alice);
    await closeSocket(bob);
  }
});

test('sets display name and timestamp on the server', async () => {
  const { socket } = await openAndJoin('ChatSpoof');
  try {
    const sentAt = Date.now();
    socket.send(JSON.stringify({
      type: 'chat',
      text: 'trusted',
      displayName: 'Admin',
      timestamp: 0,
    }));

    const message = await waitForChat(socket, 'trusted');
    assert.equal(message.displayName, 'ChatSpoof');
    assert.notEqual(message.displayName, 'Admin');
    assert.ok(message.timestamp >= sentAt);
    assert.ok(message.timestamp <= Date.now());
  } finally {
    await closeSocket(socket);
  }
});

test('rejects invalid chat text', async () => {
  const { socket } = await openAndJoin('ChatValidator');
  try {
    for (const text of ['', '   ', 'x'.repeat(201), 42, null]) {
      socket.send(JSON.stringify({ type: 'chat', text }));
      const error = await waitForError(socket, 'invalid_chat');
      assert.equal(error.type, 'error');
    }
  } finally {
    await closeSocket(socket);
  }
});

test('rejects chat before join', async () => {
  const socket = openSocket();
  try {
    await onceOpen(socket);
    socket.send(JSON.stringify({ type: 'chat', text: 'early' }));
    const error = await waitForError(socket, 'not_joined');
    assert.equal(error.type, 'error');
  } finally {
    await closeSocket(socket);
  }
});

test('rate limits chat to five messages per ten seconds', async () => {
  const { socket } = await openAndJoin('ChatRate');
  try {
    const collected = collectMessages(socket);
    for (let index = 0; index < 6; index += 1) {
      socket.send(JSON.stringify({ type: 'chat', text: `chat-${index}` }));
    }

    const received = await collected;
    const chats = received.filter((message) => message.type === 'chat');
    const limited = received.filter(
      (message) => message.type === 'error' && message.code === 'rate_limited',
    );
    assert.deepEqual(chats.map((message) => message.text), [
      'chat-0', 'chat-1', 'chat-2', 'chat-3', 'chat-4',
    ]);
    assert.equal(limited.length, 1);
    assert.ok(!chats.some((message) => message.text === 'chat-5'));
  } finally {
    await closeSocket(socket);
  }
});

test('delivers long Vietnamese text within the byte limit', async () => {
  const { socket } = await openAndJoin('ChatTiengViet');
  try {
    const text = 'Tiếng Việt '.repeat(18).trim();
    assert.ok(text.length <= 200);
    assert.ok(Buffer.byteLength(text, 'utf8') <= 1024);

    socket.send(JSON.stringify({ type: 'chat', text }));
    const message = await waitForChat(socket, text);
    assert.equal(message.text, text);
    assert.equal(message.displayName, 'ChatTiengViet');
  } finally {
    await closeSocket(socket);
  }
});

test('does not send chat history to new joiners', async () => {
  const { socket: alice } = await openAndJoin('HistoryAlice');
  let bob;
  try {
    alice.send(JSON.stringify({ type: 'chat', text: 'before-join' }));
    await waitForChat(alice, 'before-join');

    bob = openSocket();
    await onceOpen(bob);
    bob.send(JSON.stringify({ type: 'join', displayName: 'HistoryBob' }));
    await waitForMessage(bob, (message) => message.type === 'snapshot');
    const received = await collectMessages(bob, 200);
    assert.ok(!received.some((message) => message.type === 'chat'));
  } finally {
    if (bob !== undefined) await closeSocket(bob);
    await closeSocket(alice);
  }
});

test('keeps chat working after another player disconnects', async () => {
  const { socket: alice } = await openAndJoin('ChatStay');
  const { socket: bob } = await openAndJoin('ChatLeave');
  try {
    await closeSocket(bob);
    await delay(80);

    const collected = collectMessages(alice);
    alice.send(JSON.stringify({ type: 'chat', text: 'still here' }));
    const received = await collected;
    const message = received.find(
      (entry) => entry.type === 'chat' && entry.text === 'still here',
    );
    assert.ok(message, 'chat message missing after disconnect');
    assert.equal(message.displayName, 'ChatStay');
    assert.ok(!received.some((entry) => entry.type === 'error'));
  } finally {
    await closeSocket(alice);
    await closeSocket(bob);
  }
});
