const form = document.querySelector('#join-form');
const input = document.querySelector('#display-name');
const status = document.querySelector('#status');
const room = document.querySelector('#room');
const participants = document.querySelector('#participants');

let socket = null;

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
      setStatus(`Joined as ${message.displayName}.`);
      renderParticipants(message.participants);
      form.hidden = true;
      room.hidden = false;
    } else if (message.type === 'presence') {
      renderParticipants(message.participants);
    } else if (message.type === 'error') {
      setStatus(message.message);
      if (message.code === 'duplicate_display_name' || message.code === 'already_joined') {
        socket.close();
      }
    }
  });

  socket.addEventListener('close', () => {
    setStatus('Disconnected. Reload to rejoin.');
    form.hidden = false;
    room.hidden = true;
    socket = null;
  });

  socket.addEventListener('error', () => {
    setStatus('Connection failed. Is the server running?');
  });
}

function renderParticipants(names) {
  participants.replaceChildren(
    ...names.map((name) => {
      const item = document.createElement('li');
      item.textContent = name;
      return item;
    }),
  );
}

function setStatus(text) {
  status.textContent = text;
}
