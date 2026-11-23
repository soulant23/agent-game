const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const controls = document.querySelector('#audio-controls');
const micToggle = document.querySelector('#mic-toggle');
const micRetry = document.querySelector('#mic-retry');
const audioHost = document.querySelector('#audio-host');

const peers = new Map();
let send = () => {};
let reportStatus = () => {};
let selfName = '';
let participants = [];
let localStream = null;
let micEnabled = false;
let unlockAudio = null;

export function configureAudio(sendFn, statusFn) {
  send = sendFn;
  reportStatus = statusFn;
  micToggle?.addEventListener('click', toggleMic);
  micRetry?.addEventListener('click', () => void requestMic());
  updateMicButton();
}

export function primeAudioAutoplay() {
  try {
    if (unlockAudio === null) {
      unlockAudio = document.createElement('audio');
      unlockAudio.hidden = true;
      unlockAudio.src = silentWavUrl();
      document.body.append(unlockAudio);
    }
    const attempt = unlockAudio.play();
    if (attempt instanceof Promise) attempt.catch(handleBlockedAutoplay);
  } catch {
    reportStatus('Audio playback may be blocked; click the page to enable sound.');
  }
}

export function onJoinedAudio(displayName, names) {
  selfName = displayName;
  participants = [...names];
  if (controls) controls.hidden = false;

  const selfIndex = participants.findIndex((name) => normalize(name) === normalize(selfName));
  for (let index = 0; index < selfIndex; index += 1) {
    const name = participants[index];
    if (normalize(name) === normalize(selfName)) continue;
    const peer = getOrCreatePeer(name, true);
    void startOffer(peer);
  }
  void requestMic();
}

export function onPresenceAudio(names) {
  participants = [...names];
  for (const key of [...peers.keys()]) {
    if (!participants.some((name) => normalize(name) === key)) closePeer(key);
  }
}

export function onSignalAudio(message) {
  const key = normalize(message.from);
  const inRoom = participants.some((name) => normalize(name) === key);
  if (key === normalize(selfName)) return;

  if (message.kind === 'offer') {
    if (!inRoom) return;
    const peer = getOrCreatePeer(message.from, false);
    void handleOffer(peer, message.data);
    return;
  }

  const peer = peers.get(key);
  if (peer === undefined) return;
  if (message.kind === 'answer') void handleAnswer(peer, message.data);
  if (message.kind === 'ice') void handleIce(peer, message.data);
}

export function stopAudio() {
  for (const key of [...peers.keys()]) closePeer(key);
  if (localStream !== null) {
    for (const track of localStream.getAudioTracks()) track.stop();
    localStream = null;
  }
  micEnabled = false;
  participants = [];
  selfName = '';
  if (controls) controls.hidden = true;
  if (micRetry) micRetry.hidden = true;
  updateMicButton();
}

function getOrCreatePeer(name, isOfferer) {
  const key = normalize(name);
  const existing = peers.get(key);
  if (existing !== undefined) return existing;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const audio = document.createElement('audio');
  audio.hidden = true;
  audio.autoplay = true;
  audioHost?.append(audio);

  const peer = { name, pc, audio, audioSender: null, pendingIce: [] };
  peers.set(key, peer);

  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      send({ type: 'ice', target: peer.name, data: event.candidate.toJSON() });
    }
  });
  pc.addEventListener('track', (event) => {
    audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    void playRemote(audio);
  });
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') closePeer(key);
  });

  if (isOfferer) {
    const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    peer.audioSender = transceiver.sender;
    attachLocalTrack(peer);
  }
  return peer;
}

async function startOffer(peer) {
  try {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    send({ type: 'offer', target: peer.name, data: offer });
  } catch {
    reportStatus('Could not start audio with ' + peer.name + '.');
  }
}

async function handleOffer(peer, data) {
  try {
    await peer.pc.setRemoteDescription(data);
    rememberAnswerSender(peer);
    await flushIce(peer);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    send({ type: 'answer', target: peer.name, data: answer });
  } catch {
    reportStatus('Could not answer audio from ' + peer.name + '.');
  }
}

async function handleAnswer(peer, data) {
  try {
    await peer.pc.setRemoteDescription(data);
    await flushIce(peer);
  } catch {
    reportStatus('Could not complete audio with ' + peer.name + '.');
  }
}

async function handleIce(peer, data) {
  const candidate = new RTCIceCandidate(data);
  if (peer.pc.remoteDescription === null) {
    peer.pendingIce.push(candidate);
    return;
  }
  try {
    await peer.pc.addIceCandidate(candidate);
  } catch {
    // Ignore stale candidates from peers that left mid-negotiation.
  }
}

async function flushIce(peer) {
  const pending = peer.pendingIce.splice(0);
  for (const candidate of pending) {
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch {
      // Ignore stale candidates from peers that left mid-negotiation.
    }
  }
}

function rememberAnswerSender(peer) {
  if (peer.audioSender !== null) return;
  const transceiver = peer.pc
    .getTransceivers()
    .find((entry) => entry.receiver.track.kind === 'audio');
  if (transceiver) {
    peer.audioSender = transceiver.sender;
    attachLocalTrack(peer);
  }
}

function attachLocalTrack(peer) {
  const track = localStream?.getAudioTracks()[0];
  if (track === undefined || peer.audioSender === null) return;
  void peer.audioSender.replaceTrack(track).catch(() => {});
}

async function requestMic() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      reportStatus('Microphone is not available in this browser.');
      return;
    }
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micEnabled = true;
    if (micRetry) micRetry.hidden = true;
    for (const peer of peers.values()) attachLocalTrack(peer);
    reportStatus('Microphone on.');
  } catch (error) {
    micEnabled = false;
    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
      if (micRetry) micRetry.hidden = false;
      reportStatus('Microphone permission denied. Use Retry mic to try again.');
    } else {
      reportStatus('Could not start the microphone.');
    }
  } finally {
    updateMicButton();
  }
}

function toggleMic() {
  if (!micEnabled || localStream === null) {
    void requestMic();
    return;
  }
  const tracks = localStream.getAudioTracks();
  micEnabled = !tracks.every((track) => track.enabled);
  for (const track of tracks) track.enabled = micEnabled;
  updateMicButton();
}

function updateMicButton() {
  if (!micToggle) return;
  micToggle.textContent = micEnabled ? 'Mic off' : 'Mic on';
  micToggle.setAttribute('aria-pressed', String(micEnabled));
}

async function playRemote(audio) {
  try {
    await audio.play();
  } catch {
    handleBlockedAutoplay();
  }
}

function handleBlockedAutoplay() {
  reportStatus('Audio playback blocked; click the page to enable sound.');
  document.addEventListener('click', () => void unlockAudio?.play().catch(() => {}), {
    once: true,
  });
}

function closePeer(key) {
  const peer = peers.get(key);
  if (peer === undefined) return;
  const tracks = peer.audio.srcObject?.getTracks() ?? [];
  for (const track of tracks) track.stop();
  peer.audio.srcObject = null;
  peer.audio.remove();
  peer.pc.close();
  peers.delete(key);
}

function normalize(value) {
  return value.trim().toLowerCase();
}

function silentWavUrl() {
  const sampleRate = 8000;
  const samples = 800;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
