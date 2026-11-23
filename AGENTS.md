# Project: Virtual Room

Realtime virtual room. Users enter a display name and join a single room over WebSocket, move around a 2D canvas, and (later) chat and talk.
Server: Node + TypeScript + `ws`. Client: plain HTML/JS + canvas in `public/`.

## Commands
- Install: `npm install`
- Dev server: `npm run dev`
- Test: `npm test`
- Lint + types: `npm run lint && npm run typecheck`

## Architecture
(Agent: fill this in from the real code, max ~15 lines: directory map, main components, main message flow, key design decisions with one-line reasons. Show me the diff before committing.)

## Conventions
- Every WebSocket message has a TypeScript type and is validated on the server.
- Never trust client input: validate names, message size, move magnitude, and rate-limit move/chat messages.
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

## Testing rules
- If a test fails, fix the code. Never weaken or delete a test without asking.

## Do not
- Do not add new dependencies without asking.
- Do not build audio/WebRTC yet (Phase 3).