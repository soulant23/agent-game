# Audio Signaling (Phase 3)

Audio-only WebRTC mesh over the existing WebSocket. The server relays signaling
only; it never sees media. No TURN, recording, or chat/movement changes.
Mesh topology; design target up to 8 players.

## Limits
- `MAX_SIGNAL_BYTES = 8192`: serialized signaling message cap.
- `SIGNAL_LIMIT = 150` per `SIGNAL_WINDOW_MS = 10000` (plus global 60/s).
- `MAX_PAYLOAD_BYTES = 16384`: hard `ws` frame cap; chat/move still 1024 bytes.
- `MAX_PLAYERS = 8`: join rejected with `room_full` when full.
- Global 60/s counts inbound `join`/`move`/`chat`/`offer`/`answer`/`ice` per socket; outbound pushes are not counted.

## Client → server
```json
{ "type": "offer", "target": "Bob", "data": { "type": "offer", "sdp": "..." } }
```
- `type`: `offer`, `answer`, or `ice`; `target`: trimmed, 1–20 chars, joined.
- `target` must not equal the sender; self-signals are rejected as `invalid_signal`.
- `data`: non-null object; offer/answer need `sdp` string, ice needs `candidate`.
- Sender fields from the client are ignored; the server supplies the sender.
- Bad shape/size/target → `error`; excess signals are dropped, not queued.

## Server → target
```json
{ "type": "signal", "kind": "offer", "from": "Alice", "data": { "type": "offer", "sdp": "..." } }
```
- Relayed only to `target`'s joined socket in this room; sender is never echoed.
- `from` is always the server's registered display name for that socket.
- The server validates that the sender is joined before relaying, so offers create a peer on receipt; answer/ice from an unknown peer is ignored.

## Offer ownership
- Join order comes from `joined.participants` / `snapshot.players`.
- The later joiner offers each earlier player; the earlier player answers only.
- One `RTCPeerConnection` per remote player; no renegotiation yet.

## Peer lifecycle
- Offer side: create peer with an audio `sendrecv` transceiver up front; attach mic via `replaceTrack` on grant/retry.
- Answer side: reuse the remote offer's transceiver; no second `addTransceiver`; attach mic via `replaceTrack`.
- `offer`/`answer` creates or updates that peer; `ice` adds a candidate.
- A late joiner requests the mic before sending offers, so its outbound audio is in the initial offer.
- The answerer sets its transceiver to `sendrecv` before answering so its mic reaches the joiner.
- ICE arriving before `setRemoteDescription` is queued and flushed afterwards.
- On `presence` removal or `connectionState === 'failed'`, close/delete the peer and its hidden `<audio>`.

## Client
- One hidden `<audio>` per remote peer; `srcObject` holds its MediaStream.
- Mic button toggles local track `enabled`; denial shows status + retry button.
- Call `audio.play()` after the join click; blocked autoplay shows a status hint.
- STUN: `stun:stun.l.google.com:19302`. No TURN yet.

## Errors
- `invalid_signal`: bad type/target/data, self-target, or over-size payload.
- `target_not_in_room`: target missing, left, or belonged to another room.
- `room_full`: join attempt when 8 players are already joined.
- `not_joined`: signal before join. `rate_limited`: over 150 signals/10s.

## Tests
- Server: eight-player cap rejects the 9th join with `room_full`.
- Server: six players join in quick succession with no `rate_limited`.
- Server: 7 players join while one sends `move` at 20/s; no signaling message is dropped.
- Server: chat/move payloads over 1024 bytes still rejected; signaling oversize uses 8192.
- Browser: fake media, later-joiner offers, mic toggle/retry, queued ICE, failed-peer cleanup.
