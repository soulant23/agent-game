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

const IDLE_FRAMES = 12;
const RUN_FRAMES = 6;
const IDLE_FRAME_MS = 150;
const RUN_FRAME_MS = 80;
const SPRITE_DRAW_WIDTH = 48;

const form = document.querySelector('#join-form');
const input = document.querySelector('#display-name');
const status = document.querySelector('#status');
const hint = document.querySelector('#hint');
const canvas = document.querySelector('#room-canvas');
const context = canvas.getContext('2d');
context.imageSmoothingEnabled = false;
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
let previousSnapshot = null;
let currentSnapshot = null;
let renderFrame = null;
const avatarStates = new Map();
const sprites = { idle: null, run: null };
let spritesLoaded = false;

const spritesReady = Promise.all([
  loadSprite('/assets/Tuxedo-Idle.png', IDLE_FRAMES, 'Tuxedo-Idle.png'),
  loadSprite('/assets/Tuxedo-Run.png', RUN_FRAMES, 'Tuxedo-Run.png'),
]).then(([idle, run]) => {
  sprites.idle = idle;
  sprites.run = run;
  spritesLoaded = true;
});

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

function loadSprite(url, expectedFrameCount, name) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const frameW = image.naturalWidth / expectedFrameCount;
      if (!Number.isInteger(frameW) || image.naturalHeight <= 0) {
        console.warn(
          `${name}: width ${image.naturalWidth} is not evenly divisible by ` +
            `${expectedFrameCount} frames; frame count is probably wrong.`,
        );
      }
      resolve({
        image,
        frameW,
        frameH: image.naturalHeight,
        frameCount: expectedFrameCount,
      });
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
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
      void spritesReady.then(() => {
        if (joined) startRenderLoop();
      });
    } else if (message.type === 'snapshot' || message.type === 'positions') {
      const now = performance.now();
      updateAvatarStates(players, message.players, now);
      previousSnapshot = currentSnapshot;
      currentSnapshot = { players: message.players.map((player) => ({ ...player })), time: now };
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
  if (!spritesLoaded) return;
  context.fillStyle = canvasTokens.background;
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  context.strokeStyle = canvasTokens.boundary;
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, WORLD_WIDTH - 1, WORLD_HEIGHT - 1);

  const now = performance.now();
  for (const player of interpolatedPlayers(now)) {
    const drawnHeight = drawCat(player, now);
    if (drawnHeight === null) {
      drawCircle(player);
      drawLabel(player, null);
    } else {
      drawLabel(player, drawnHeight);
    }
  }
}

function drawCat(player, now) {
  const avatar = avatarStates.get(player.displayName);
  if (avatar === undefined) return null;
  const sprite = avatar.state === 'run' ? sprites.run : sprites.idle;
  if (sprite === null) return null;

  const frame = advanceAvatar(avatar, sprite, now);
  const drawH = SPRITE_DRAW_WIDTH * (sprite.frameH / sprite.frameW);
  const drawX = player.x - SPRITE_DRAW_WIDTH / 2;
  const drawY = player.y + PLAYER_RADIUS - drawH;
  const sourceX = frame * sprite.frameW;

  if (avatar.facing < 0) {
    context.save();
    context.translate(drawX + SPRITE_DRAW_WIDTH / 2, drawY + drawH / 2);
    context.scale(-1, 1);
    context.drawImage(
      sprite.image,
      sourceX, 0, sprite.frameW, sprite.frameH,
      -SPRITE_DRAW_WIDTH / 2, -drawH / 2, SPRITE_DRAW_WIDTH, drawH,
    );
    context.restore();
  } else {
    context.drawImage(
      sprite.image,
      sourceX, 0, sprite.frameW, sprite.frameH,
      drawX, drawY, SPRITE_DRAW_WIDTH, drawH,
    );
  }
  return drawH;
}

function drawCircle(player) {
  context.beginPath();
  context.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
  context.fillStyle = canvasTokens.players[playerColorIndex(player.displayName)];
  context.fill();
  context.strokeStyle =
    player.displayName === selfDisplayName ? canvasTokens.self : canvasTokens.playerOutline;
  context.stroke();
}

function drawLabel(player, drawnHeight) {
  const top = drawnHeight === null
    ? player.y - PLAYER_RADIUS
    : player.y + PLAYER_RADIUS - drawnHeight;
  context.fillStyle = canvasTokens.label;
  context.font = canvasTokens.labelFont;
  context.textAlign = 'center';
  context.fillText(player.displayName, player.x, top - 6);
}

function interpolatedPlayers(now) {
  if (currentSnapshot === null) return players;
  if (previousSnapshot === null) return currentSnapshot.players;

  const interval = currentSnapshot.time - previousSnapshot.time;
  const elapsed = now - previousSnapshot.time;
  const alpha = interval > 0 ? Math.max(0, Math.min(1, elapsed / interval)) : 1;

  return currentSnapshot.players.map((player) => {
    const before = previousSnapshot.players.find((entry) => entry.displayName === player.displayName);
    if (before === undefined) return player;
    return {
      ...player,
      x: before.x + (player.x - before.x) * alpha,
      y: before.y + (player.y - before.y) * alpha,
    };
  });
}

function updateAvatarStates(previousPlayers, nextPlayers, now) {
  const names = new Set(nextPlayers.map((player) => player.displayName));
  for (const name of [...avatarStates.keys()]) {
    if (!names.has(name)) avatarStates.delete(name);
  }

  for (const player of nextPlayers) {
    const before = previousPlayers.find((entry) => entry.displayName === player.displayName);
    let avatar = avatarStates.get(player.displayName);
    if (avatar === undefined) {
      avatar = { state: 'idle', facing: 1, frameIndex: 0, lastFrameAt: now };
      avatarStates.set(player.displayName, avatar);
    }
    if (before === undefined) continue;

    const dx = player.x - before.x;
    const dy = player.y - before.y;
    const state = Math.hypot(dx, dy) > 0.5 ? 'run' : 'idle';
    if (state !== avatar.state) {
      avatar.state = state;
      avatar.frameIndex = 0;
      avatar.lastFrameAt = now;
    }
    if (Math.abs(dx) > 0.5) avatar.facing = dx < 0 ? -1 : 1;
  }
}

function advanceAvatar(avatar, sprite, now) {
  const duration = avatar.state === 'run' ? RUN_FRAME_MS : IDLE_FRAME_MS;
  const elapsed = Math.max(0, now - avatar.lastFrameAt);
  if (elapsed >= duration) {
    const steps = Math.floor(elapsed / duration);
    avatar.frameIndex = (avatar.frameIndex + steps) % sprite.frameCount;
    avatar.lastFrameAt += steps * duration;
  }
  return avatar.frameIndex;
}

function startRenderLoop() {
  if (renderFrame !== null) return;
  const draw = () => {
    render();
    renderFrame = requestAnimationFrame(draw);
  };
  renderFrame = requestAnimationFrame(draw);
}

function stopRenderLoop() {
  if (renderFrame !== null) cancelAnimationFrame(renderFrame);
  renderFrame = null;
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
  stopRenderLoop();
  previousSnapshot = null;
  currentSnapshot = null;
  avatarStates.clear();
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
