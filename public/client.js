const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const PLAYER_RADIUS = 12;
const MOVE_INTERVAL_MS = 50;
const MOVE_KEYS = new Set([
  'w', 'a', 's', 'd',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
]);

const form = document.querySelector('#join-form');
const input = document.querySelector('#display-name');
const status = document.querySelector('#status');
const hint = document.querySelector('#hint');
const canvas = document.querySelector('#room-canvas');
const context = canvas.getContext('2d');

let socket = null;
let joined = false;
let moveTimer = null;
let players = [];
const keys = new Set();

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
  connect(displayName);
});

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (!MOVE_KEYS.has(key)) return;
  event.preventDefault();
  keys.add(key);
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.key.toLowerCase());
});

function connect(displayName) {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}`);
  setStatus(`Connecting as ${displayName}…`);

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
      setStatus(`Joined as ${message.displayName}.`);
      form.hidden = true;
      hint.hidden = false;
      canvas.hidden = false;
      moveTimer = setInterval(sendMovementIntent, MOVE_INTERVAL_MS);
    } else if (message.type === 'snapshot' || message.type === 'positions') {
      players = message.players;
      render();
    } else if (message.type === 'error') {
      setStatus(message.message);
      if (message.code === 'duplicate_display_name' || message.code === 'already_joined') {
        socket.close();
      }
    }
  });

  socket.addEventListener('close', () => {
    stopPlaying();
    setStatus('Disconnected. Reload to rejoin.');
  });

  socket.addEventListener('error', () => {
    setStatus('Connection failed. Is the server running?');
  });
}

function sendMovementIntent() {
  if (!joined || !socket || socket.readyState !== WebSocket.OPEN) return;

  let dx = 0;
  let dy = 0;
  if (keys.has('w') || keys.has('arrowup')) dy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dy += 1;
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
  if (keys.has('d') || keys.has('arrowright')) dx += 1;

  const magnitude = Math.hypot(dx, dy);
  if (magnitude > 0) {
    dx /= magnitude;
    dy /= magnitude;
  }
  socket.send(JSON.stringify({ type: 'move', dx, dy }));
}

function render() {
  context.fillStyle = '#f8fafc';
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  for (const player of players) {
    context.beginPath();
    context.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
    context.fillStyle = '#2563eb';
    context.fill();
    context.strokeStyle = '#1e3a8a';
    context.stroke();

    context.fillStyle = '#111827';
    context.font = '14px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(player.displayName, player.x, player.y - PLAYER_RADIUS - 6);
  }
}

function stopPlaying() {
  joined = false;
  keys.clear();
  players = [];
  if (moveTimer !== null) clearInterval(moveTimer);
  moveTimer = null;
  socket = null;
}

function setStatus(text) {
  status.textContent = text;
}
