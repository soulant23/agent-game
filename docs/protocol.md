# Virtual Room WebSocket Protocol

Phase 2a adds movement only; there is no chat protocol. Clients send movement
intent, never absolute positions. The server owns authoritative positions,
validates intents, and publishes state on a fixed tick.

## Constants

| Name | Value | Meaning |
| --- | --- | --- |
| `WORLD_WIDTH` | `800` | Canvas width in pixels |
| `WORLD_HEIGHT` | `600` | Canvas height in pixels |
| `PLAYER_RADIUS` | `12` | Circle radius and center-to-edge margin |
| `MAX_SPEED` | `200` | Pixels per second |
| `TICK_RATE` | `20` | Position broadcasts per second (50 ms) |
| `MAX_MOVE_INTERVAL_MS` | `100` | Max elapsed time used for one move |
| `MAX_MESSAGES_PER_SECOND` | `60` | Per-socket message limit |
| `MAX_MESSAGE_BYTES` | `1024` | Existing payload limit |

Valid centers: `x` in `[12, 788]`, `y` in `[12, 588]`; spawn `(400, 300)`; outbound coordinates rounded to 2 decimals.

## Client to server

### `move`

```json
{ "type": "move", "dx": 1, "dy": 0 }
```

| Field | Type | Rule |
| --- | --- | --- |
| `type` | `"move"` | Required |
| `dx` | number | Finite number |
| `dy` | number | Finite number |
| magnitude | derived | `sqrt(dx * dx + dy * dy) <= 1 + 1e-6` |

`dx`/`dy` are direction intent, not a target. Diagonals must be normalized,
e.g. `(Math.SQRT1_2, Math.SQRT1_2)`; the tolerance accepts floating-point drift.
`lastMoveAt` starts at join time. Stopping means sending no moves or `(0, 0)`.
Extra fields are ignored; invalid fields produce an `error`.

## Server behavior

For each structurally valid `move`:

1. `elapsedMs = min(now - lastMoveAt, MAX_MOVE_INTERVAL_MS)` using server clock.
2. `nextX = x + dx * MAX_SPEED * elapsedMs / 1000` (likewise for `y`).
3. Clamp `nextX`/`nextY` into the valid center range; a clamped move is
   accepted, not an error.
4. Round the accepted position to 2 decimals.
5. Update `lastMoveAt` for every structurally valid intent, accepted or not,
   so a rejected move cannot create a later speed bonus.

Magnitude above the tolerance is rejected as `invalid_move_magnitude`. The
server never trusts client timestamps or positions.

### Rate limiting

Each socket may send at most 60 messages per second. Extra messages are ignored.
A `rate_limited` error is sent at most once per second while the limit is
exceeded.

## Server to client

### `joined` (existing)

```json
{ "type": "joined", "displayName": "Alice", "participants": ["Alice"] }
```

### `snapshot` (new)

Sent once after `joined`, to the joiner only, including the joiner at spawn.

```json
{
  "type": "snapshot",
  "players": [{ "displayName": "Alice", "x": 400, "y": 300 }]
}
```

### `positions` (new)

Broadcast to all joined clients every 50 ms, even when nothing moved.

```json
{
  "type": "positions",
  "tick": 12,
  "players": [
    { "displayName": "Alice", "x": 420, "y": 300 },
    { "displayName": "Bob", "x": 400, "y": 300 }
  ]
}
```

`tick` increments per broadcast; `players` is ordered by join order.

### `presence` (existing)

Unchanged: `{ "type": "presence", "participants": ["Alice", "Bob"] }`.

### `error` (extended)

```json
{ "type": "error", "code": "invalid_move_magnitude", "message": "Move magnitude must be at most 1." }
```

| Code | When |
| --- | --- |
| `invalid_message` | Malformed JSON or unknown message type |
| `message_too_large` | Payload exceeds 1024 bytes |
| `invalid_display_name` | Empty, non-string, or longer than 20 chars |
| `duplicate_display_name` | Name already in use, case-insensitive |
| `already_joined` | A second `join` on the same socket |
| `not_joined` | `move` received before `join` |
| `invalid_move` | Missing or non-finite `dx` or `dy` |
| `invalid_move_magnitude` | Magnitude greater than `1 + 1e-6` |
| `rate_limited` | More than 60 messages in one second |

An error changes no authoritative state.

## Ordering and lifecycle

- Join: `joined` → `snapshot` → `presence` (broadcast to everyone).
- Movement: `move` may produce an `error`; state changes appear in the next
  `positions` broadcast.
- Disconnect: the player is removed immediately; the next `presence` and
  `positions` broadcasts exclude them.
