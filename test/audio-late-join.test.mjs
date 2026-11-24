import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

globalThis.document = {
  querySelector: () => null,
  createElement: () => ({
    hidden: false,
    autoplay: false,
    srcObject: null,
    remove() {},
    play: async () => {},
  }),
};

const { configureAudio, onJoinedAudio, onSignalAudio, stopAudio } = await import('../public/audio.js');

const events = [];
const sent = [];
const connections = [];

let mic;
let fakeStream;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeSender {
  async replaceTrack(track) {
    this.track = track;
    events.push('replaceTrack');
  }
}

class FakeTransceiver {
  constructor(direction) {
    this.direction = direction;
    this.sender = new FakeSender();
    this.receiver = { track: { kind: 'audio' } };
  }
}

class FakeRTCPeerConnection {
  constructor() {
    this.transceivers = [];
    this.remoteDescription = null;
    this.localDescription = null;
    this.connectionState = 'new';
    connections.push(this);
  }

  addEventListener() {}

  addTransceiver(kind, init) {
    const transceiver = new FakeTransceiver(init.direction);
    this.transceivers.push(transceiver);
    return transceiver;
  }

  async createOffer() {
    events.push('createOffer');
    return { type: 'offer', sdp: 'v=0 offer' };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async createAnswer() {
    events.push('createAnswer');
    return { type: 'answer', sdp: 'v=0 answer' };
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
    if (this.transceivers.length === 0) {
      this.transceivers.push(new FakeTransceiver('recvonly'));
    }
  }

  async addIceCandidate() {}

  getTransceivers() {
    return this.transceivers;
  }

  close() {
    this.connectionState = 'closed';
  }
}

beforeEach(() => {
  events.length = 0;
  sent.length = 0;
  connections.length = 0;

  mic = deferred();
  fakeStream = {
    getAudioTracks: () => [{ kind: 'audio', enabled: true, stop() {} }],
  };

  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia: () => mic.promise } },
    configurable: true,
  });
  globalThis.RTCPeerConnection = FakeRTCPeerConnection;
  globalThis.RTCIceCandidate = class {
    constructor(data) {
      Object.assign(this, data);
    }
  };

  configureAudio((message) => sent.push(message), () => {});
});

afterEach(async () => {
  stopAudio();
  await new Promise((resolve) => setImmediate(resolve));
});

test('late joiner attaches the mic before offering existing players', async () => {
  const joined = onJoinedAudio('Late', ['Alice', 'Late']);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 0, 'no offer before mic permission resolves');

  mic.resolve(fakeStream);
  await joined;

  const offers = sent.filter((message) => message.type === 'offer');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].target, 'Alice');
  assert.ok(
    events.indexOf('replaceTrack') < events.indexOf('createOffer'),
    'track is attached before the offer is created',
  );
});

test('answerer enables sendrecv before answering', async () => {
  mic.resolve(fakeStream);
  await onJoinedAudio('Answerer', ['Answerer']);

  await onSignalAudio({ kind: 'offer', from: 'Alice', data: { type: 'offer', sdp: 'v=0' } });

  const peerConnection = connections.at(-1);
  assert.equal(peerConnection.transceivers[0].direction, 'sendrecv');
  assert.ok(events.indexOf('replaceTrack') < events.indexOf('createAnswer'));
  assert.ok(sent.some((message) => message.type === 'answer'));
});

test('accepts an offer before presence has listed the sender', async () => {
  mic.resolve(fakeStream);
  await onJoinedAudio('Late', ['Late']);

  await onSignalAudio({ kind: 'offer', from: 'Alice', data: { type: 'offer', sdp: 'v=0' } });

  assert.ok(sent.some((message) => message.type === 'answer'));
});
