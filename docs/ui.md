# UI Tokens (Material 3)

Dark-only scheme. All colors live in `public/tokens.css` as `--md-sys-color-*`
from the Material Theme Builder export; a light scheme later only redefines
those values. `tokens.css` is the single source of truth for exact colors.

## Color tokens
`--md-sys-color-primary`, `--md-sys-color-on-primary`,
`--md-sys-color-surface`, `--md-sys-color-on-surface`,
`--md-sys-color-surface-container-low`, `--md-sys-color-surface-container-high`,
`--md-sys-color-surface-container-highest`, `--md-sys-color-on-surface-variant`,
`--md-sys-color-outline`, `--md-sys-color-outline-variant`,
`--md-sys-color-secondary-container`, `--md-sys-color-on-secondary-container`,
`--md-sys-color-error`, `--md-sys-color-on-error`.

## App tokens (`--app-*`)
- Status: `--app-color-connecting`, `--app-color-connected`, `--app-color-disconnected`.
- Players: `--app-player-1` … `--app-player-8`, assigned by join order.
- Spacing: `--app-space-1` 4px, `--app-space-2` 8px, `--app-space-3` 16px,
  `--app-space-4` 24px, `--app-space-5` 32px.
- Radius: `--app-radius-sm`, `--app-radius-md`, `--app-radius-lg`.
- Duration: `--app-duration-fast`, `--app-duration-medium`, `--app-duration-slow`.
- Elevation: `--app-shadow-soft` (the only shadow token).

## Typography
Roles: `--app-type-title` 22/28px, `--app-type-body` 14/20px,
`--app-type-label` 12/16px. Font stack: `Roboto, system-ui, sans-serif`.
No font files, downloads, or external requests.

## Interaction states
Hover, focus, and pressed use one translucent `--app-state-layer` derived from
`on-surface`; no component defines its own literal color.

| State | Token behavior |
| --- | --- |
| connecting | status text uses `--app-color-connecting` |
| connected | status text uses `--app-color-connected` |
| disconnected | status text uses `--app-color-disconnected` |
| mic on | `secondary-container` / `on-secondary-container`; pressed state layer |
| mic off | `surface-container-high` / `on-surface-variant` |
| mic denied | `error` / `on-error`; retry keeps error outline |

## Usage rules
- CSS and canvas use tokens only; no color literals outside `tokens.css`.
- Canvas reads tokens once via `getComputedStyle` at startup.
- `npm test` fails on color literals in `public/` outside `tokens.css`.
- Layout, `WORLD_WIDTH x WORLD_HEIGHT`, protocol, and audio logic stay unchanged.
- Chat and player names remain `textContent`; no HTML injection.
