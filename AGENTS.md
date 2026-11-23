# Project: Virtual Room

Realtime virtual room. Users enter a display name and join a single room over WebSocket, move around a 2D canvas, chat, and talk with audio.
Server: Node + TypeScript + `ws`. Client: plain HTML/JS + canvas in `public/`.

## Commands
- Install: `npm install`
- Dev server: `npm run dev`
- Test: `npm test`
- Lint + types: `npm run lint && npm run typecheck`

## Architecture
- `src/messages.ts` — typed WS contract and shared constants (payload, world, tick, chat limits).
- `src/validate.ts` — JSON parsing and per-message validation; returns typed messages or error codes.
- `src/room.ts` — in-memory member map with authoritative positions and join-time spawn state.
- `src/server.ts` — HTTP static host + `ws` upgrade; global/chat/signal limits, target-only signal relay, 20 Hz tick.
- `public/index.html` + `public/client.js` — join form, canvas renderer, keyboard intent, chat UI, audio dispatch.
- `public/audio.js` — audio-only WebRTC mesh; mic toggle, retry, ICE queue, peer cleanup.
- `test/room-integration.test.mjs` — real-`ws` coverage via `startServer(0)`.
- `.github/workflows/ci.yaml` — runs lint, typecheck, and tests on PRs to `main`.
- Flow: `join` → `joined`/`snapshot`/`presence`; `move` → server clamps → periodic `positions`.
- Flow: `chat` → server trims/validates/rate-limits → immediate `chat` broadcast to joined sockets.
- Flow: `offer`/`answer`/`ice` → server-set sender → target-only `signal`; later joiner offers earlier players.
- Server sets display names/timestamps and owns positions; clients send intent/text only, preventing spoofing.
- Rate limits are per socket in memory; excess messages are dropped, not queued (bounded memory).
- No persistence or chat history; new joiners get only a position snapshot (Phase 2 scope).

## Conventions
- Every WebSocket message has a TypeScript type and is validated on the server.
- Never trust client input: validate names, message size, move magnitude, and rate-limit move/chat/signaling messages.
- The server is authoritative for positions; clients send intent only.
- Room state lives in memory. No database yet.

## Workflow
- Never commit or push directly to `main`.
- For each task: create a new branch (`feature/<name>` or `fix/<name>`), commit in small steps, push the branch, and open a pull request into `main`.
- The PR description must say what changed, how it was verified, and anything I should review closely.
- Run lint, typecheck, and tests before opening the PR. Do not merge the PR yourself.
- For non-trivial tasks, propose a plan first and wait for approval before coding.
- Anything involving connections needs an integration test using real WebSocket clients.

## Docs
- WebSocket message protocol: see `docs/protocol.md`. Update it in the same commit whenever a message type changes.
- Audio signaling: see `docs/audio-signaling.md`.

## Testing rules
- If a test fails, fix the code. Never weaken or delete a test without asking.

## Do not
- Do not add new dependencies without asking.