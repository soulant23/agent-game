# AGENTS.md

# Project: Virtual Room

Realtime virtual room. Phase 1: a single room where users enter a display name and connect over WebSocket.
Server: Node + TypeScript + `ws`. Client: plain HTML/JS in `public/`.

## Commands
- Install: `npm install`
- Dev server: `npm run dev`
- Test: `npm test`
- Lint + types: `npm run lint && npm run typecheck`

## Conventions
- Every WebSocket message has a TypeScript type and is validated on the server.
- Never trust client input: validate display names (non-empty, max 20 chars, unique in the room) and message size.
- Room state lives in memory. No database yet.

## Workflow
- One small commit per task. Run lint, typecheck, and tests before reporting a task as done.
- Anything involving connections needs an integration test using real WebSocket clients.
- For non-trivial tasks, propose a plan first and wait for approval before coding.

## Docs
- WebSocket message protocol: see `docs/protocol.md`. Update it in the same commit whenever a message type changes.

## Testing rules
- If a test fails, fix the code. Never weaken or delete a test without asking.

## Do not
- Do not add new dependencies without asking.
- Do not build audio/WebRTC yet (Phase 3).