# UI Tokens (Material 3)

Light scheme from the pasted Material 3 export. All colors live in `public/tokens.css`
as `--md-sys-color-*`; dark later only redefines those values.

## Color tokens
`--md-sys-color-primary`, `--md-sys-color-on-primary`,
`--md-sys-color-surface`, `--md-sys-color-on-surface`,
`--md-sys-color-surface-container-low`, `--md-sys-color-surface-container-high`,
`--md-sys-color-surface-container-highest`, `--md-sys-color-on-surface-variant`,
`--md-sys-color-outline`, `--md-sys-color-outline-variant`,
`--md-sys-color-secondary-container`, `--md-sys-color-on-secondary-container`,
`--md-sys-color-error`, `--md-sys-color-on-error`.

## App tokens (`--app-*`)
- Status on surface (#fefbff): connecting `#7a4e00` (dark amber) 7.01:1,
  connected `#1b7f3a` 4.94:1, disconnected `#ba1a1a` 6.29:1.
- Players: `--app-player-1` … `--app-player-8`, assigned by join order.
- Player fills on canvas (#f5f3f7): `#005bc0` 5.85:1, `#b3261e` 5.93:1,
  `#1b7f3a` 4.60:1, `#7a4e00` 6.53:1, `#715574` 5.85:1,
  `#006b6b` 5.74:1, `#8e457a` 5.80:1, `#3f5e00` 6.77:1.
- Thin `--app-player-outline`: surface (#fefbff), min 4.94:1 vs fills.
- Index = lowercase-name hash mod 8; collisions possible; server `colorIndex` later.
- Spacing: `--app-space-1` 4px, `--app-space-2` 8px, `--app-space-3` 16px,
  `--app-space-4` 24px, `--app-space-5` 32px.
- Radius: `--app-radius-sm`, `--app-radius-md`, `--app-radius-lg`.
- Duration: `--app-duration-fast`, `--app-duration-medium`, `--app-duration-slow`.
- Elevation: `--app-shadow-soft` (the only shadow token).

## Canvas mapping
background = surface-container-low; boundary = outline-variant; label = on-surface; my outline = primary.

## Typography
Roles: `--app-type-title` 22/28px, `--app-type-body` 14/20px,
`--app-type-label` 12/16px. Font stack: `Roboto, system-ui, sans-serif`.
No font files, downloads, or external requests.

## Interaction states
`--app-state-hover/focus/pressed` are translucent `on-surface` layers.
Disabled uses `--app-state-disabled`; `:focus-visible` adds a 2px `primary` outline.

| State | Token behavior |
| --- | --- |
| connecting | status text uses `--app-color-connecting` |
| connected | status text uses `--app-color-connected` |
| disconnected | status text uses `--app-color-disconnected` |
| mic on | `secondary-container` / `on-secondary-container`; pressed state layer |
| mic off | `surface-container-high` / `on-surface-variant` |
| mic denied | `error` / `on-error`; retry keeps error outline |
| disabled | `--app-state-disabled` over `surface-container-high` |

## Usage rules
- CSS and canvas use tokens only; no color literals outside `tokens.css`.
- Canvas reads tokens once via `getComputedStyle` at startup.
- `npm test` rejects hex/rgb()/rgba()/hsl() outside `tokens.css` in CSS/JS/inline styles.
- It also requires every `var(--x)` used in `public/` to be defined in `tokens.css`.
- Panels use surface-container tones + `--app-shadow-soft`; no heavy borders.
- Layout, `WORLD_WIDTH x WORLD_HEIGHT`, protocol, and audio logic stay unchanged.
- Chat and player names remain `textContent`; no HTML injection.
