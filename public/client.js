import {
  configureAudio,
  onJoinedAudio,
  onPresenceAudio,
  onSignalAudio,
  primeAudioAutoplay,
  stopAudio,
} from './audio.js';

const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const PLAYER_RADIUS = 12;
const TICK_RATE = 20;
const MAX_SPEED = 200;
const MOVE_STEP = MAX_SPEED / TICK_RATE;
const MOVE_INTERVAL_MS = 1000 / TICK_RATE;
const ARRIVAL_DISTANCE = 2;
const HOLD_THRESHOLD_MS = 200;

const form = document.querySelector('#join-form');
const input = document.querySelector('#display-name');
const status = document.querySelector('#status');
const hint = document.querySelector('#hint');
const canvas = document.querySelector('#room-canvas');
const context = canvas.getContext('2d');
const chat = document.querySelector('#chat');
const messages = document.querySelector('#messages');
const chatForm = document.querySelector('#chat-form');
const chatInput = document.querySelector('#chat-input');

let socket = null;
let joined = false;
let moveTimer = null;
let players = [];
let selfDisplayName = '';
let target = null;
let pointerHeld = false;
let activePointerId = null;
let pointerStartX = 0;
let pointerStartY = 0;
let pointerDownAt = 0;

const rootStyles = getComputedStyle(document.documentElement);
const canvasTokens = {
  background: readToken('--md-sys-color-surface-container-low'),
  boundary: readToken('--md-sys-color-outline-variant'),
  label: readToken('--md-sys-color-on-surface'),
  self: readToken('--md-sys-color-primary'),
  playerOutline: readToken('--app-player-outline'),
  labelFont: readToken('--app-type-body'),
  players: Array.from({ length: 8 }, (_, index) => readToken(`--app-player-${index + 1}`)),
};

function readToken(name) {
  return rootStyles.getPropertyValue(name).trim();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const displayName = input.value.trim();
  if (!displayName) {
    setStatus('Display name is required.');
    return;
  }
  if (displayName.length > 20) {
    setStatus('Display name must be at most 20 characters.');
    return;
  }
  primeAudioAutoplay();
  connect(displayName);
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!joined || !socket || socket.readyState !== WebSocket.OPEN) return;
  const text = chatInput.value;
  if (text.trim().length === 0) return;
  socket.send(JSON.stringify({ type: 'chat', text }));
  chatInput.value = '';
  chatInput.focus();
});

canvas.addEventListener('pointerdown', (event) => {
  if (!joined || pointerHeld) return;
  event.preventDefault();
  pointerHeld = true;
  activePointerId = event.pointerId;
  pointerDownAt = Date.now();
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  target = toWorld(event);
  canvas.setPointerCapture?.(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (!pointerHeld || event.pointerId !== activePointerId) return;
  target = toWorld(event);
});

canvas.addEventListener('pointerup', (event) => {
  if (!pointerHeld || event.pointerId !== activePointerId) return;
  const moved = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) > 4;
  const held = Date.now() - pointerDownAt >= HOLD_THRESHOLD_MS;
  if (moved || held) target = null;
  endPointer(event);
});

canvas.addEventListener('pointercancel', (event) => {
  if (!pointerHeld || event.pointerId !== activePointerId) return;
  target = null;
  endPointer(event);
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') chatInput.blur();
});

function connect(displayName) {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}`);
  setStatus(`Connecting as ${displayName}…`, 'connecting');

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'join', displayName }));
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === 'joined') {
      joined = true;
      selfDisplayName = message.displayName;
      setStatus(`Joined as ${message.displayName}.`, 'connected');
      form.hidden = true;
      hint.hidden = false;
      canvas.hidden = false;
      chat.hidden = false;
      void onJoinedAudio(message.displayName, message.participants);
      moveTimer = setInterval(sendMovementIntent, MOVE_INTERVAL_MS);
    } else if (message.type === 'snapshot' || message.type === 'positions') {
      players = message.players;
      render();
    } else if (message.type === 'chat') {
      appendChat(message);
    } else if (message.type === 'presence') {
      onPresenceAudio(message.participants);
    } else if (message.type === 'signal') {
      void onSignalAudio(message);
    } else if (message.type === 'error') {
      setStatus(message.message, 'disconnected');
      if (message.code === 'duplicate_display_name' || message.code === 'already_joined') {
        socket.close();
      }
    }
  });

  socket.addEventListener('close', () => {
    stopPlaying();
    setStatus('Disconnected. Reload to rejoin.', 'disconnected');
  });

  socket.addEventListener('error', () => {
    setStatus('Connection failed. Is the server running?', 'disconnected');
  });
}

function sendMovementIntent() {
  if (!joined || !socket || socket.readyState !== WebSocket.OPEN) return;
  if (target === null) return;

  const me = players.find((player) => player.displayName === selfDisplayName);
  if (me === undefined) return;

  const vx = target.x - me.x;
  const vy = target.y - me.y;
  const dist = Math.hypot(vx, vy);
  if (dist < ARRIVAL_DISTANCE) {
    socket.send(JSON.stringify({ type: 'move', dx: 0, dy: 0 }));
    target = null;
    return;
  }

  const scale = Math.min(1, dist / MOVE_STEP) / dist;
  socket.send(JSON.stringify({ type: 'move', dx: vx * scale, dy: vy * scale }));
}

function toWorld(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (WORLD_WIDTH / rect.width);
  const y = (event.clientY - rect.top) * (WORLD_HEIGHT / rect.height);
  return {
    x: clamp(x, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS),
    y: clamp(y, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function endPointer(event) {
  pointerHeld = false;
  activePointerId = null;
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}

function render() {
  context.fillStyle = canvasTokens.background;
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  context.strokeStyle = canvasTokens.boundary;
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, WORLD_WIDTH - 1, WORLD_HEIGHT - 1);

  for (const player of players) {
    context.beginPath();
    context.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
    context.fillStyle = canvasTokens.players[playerColorIndex(player.displayName)];
    context.fill();
    context.strokeStyle =
      player.displayName === selfDisplayName ? canvasTokens.self : canvasTokens.playerOutline;
    context.stroke();

    context.fillStyle = canvasTokens.label;
    context.font = canvasTokens.labelFont;
    context.textAlign = 'center';
    context.fillText(player.displayName, player.x, player.y - PLAYER_RADIUS - 6);
  }
}

function playerColorIndex(displayName) {
  let hash = 0;
  for (const char of displayName.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % canvasTokens.players.length;
}

function appendChat(message) {
  const item = document.createElement('li');
  const name = document.createElement('strong');
  name.textContent = `${message.displayName}: `;
  const text = document.createElement('span');
  text.textContent = message.text;
  item.append(name, text);
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function stopPlaying() {
  stopAudio();
  joined = false;
  selfDisplayName = '';
  target = null;
  pointerHeld = false;
  activePointerId = null;
  players = [];
  if (moveTimer !== null) clearInterval(moveTimer);
  moveTimer = null;
  socket = null;
  chat.hidden = true;
  messages.replaceChildren();
  chatInput.value = '';
}

function setStatus(text, state = 'disconnected') {
  status.textContent = text;
  status.dataset.state = state;
}

function sendAudio(message) {
  if (!joined || !socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

configureAudio(sendAudio, setStatus);
