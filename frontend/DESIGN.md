# Color Schema & Window Style

Source of truth for the app's visual design tokens. CSS custom properties
implementing these live in `src/index.css` (`:root[data-theme="dark"]` /
`:root[data-theme="light"]`); component styles should reference `var(--token)`
rather than hardcoding hex values, so theme/brand updates only need to
happen in one place.

## Typography
- Headings, titlebars, buttons, labels: **Quicksand** (500/600/700)
- Body copy: **Nunito** (400 body, 600–700 emphasis)
- Loaded via Google Fonts in `index.html`; applied globally in `index.css`
  (`html/body` → Nunito, `h1–h6`/`button`/`label` → Quicksand).

## Colors — Dark theme (`--bg`, `--surface`, ... in `index.css`)
| Token | CSS var | Hex |
|---|---|---|
| Background | `--bg` | `#0e0e10` |
| Surface | `--surface` | `#18181b` |
| Surface 2 | `--surface2` | `#1f1f23` |
| Border | `--border` | `#2a2a2e` |
| Accent (Pink) | `--accent` | `#e11d76` |
| Accent Light | `--accent-light` | `#f0429b` |
| Accent Dark | `--accent-dark` | `#b0155c` |
| Text | `--text` | `#efeff1` |
| Text Muted | `--text-muted` | `#adadb8` |

## Colors — Light theme
| Token | CSS var | Hex |
|---|---|---|
| Background | `--bg` | `#f4f4f6` |
| Surface | `--surface` | `#ffffff` |
| Surface 2 | `--surface2` | `#f0f0f3` |
| Border | `--border` | `#dcdce0` |
| Accent (Pink) | `--accent` | `#e11d76` |
| Accent Dark | `--accent-dark` | `#b0155c` |
| Text | `--text` | `#1c1c1f` |
| Text Muted | `--text-muted` | `#63636b` |

## Status colors (theme-independent)
| State | CSS var | Hex |
|---|---|---|
| Live / On | `--green` | `#22c55e` |
| Accent / Recording | `--accent` | `#e11d76` |
| Disconnected | `--red` | `#ef4444` |
| Warning | `--yellow` | `#ffb31a` |

## Window chrome (`Window.jsx`)
- Corner radius: `9px`
- Border: `1px solid var(--border)`
- Shadow: `var(--shadow)` — `0 4px 16px rgba(0,0,0,.28)` dark / `.14` alpha light
- Titlebar height: `36px`
- Titlebar background: `var(--accent)`, white (`var(--on-accent)`) text/icons
- Body: internal panel content owns its own padding (don't add padding at
  the `Window` body-wrapper level — it would double up with panels that
  already pad themselves)

## Buttons
- Primary: bg `var(--accent)`, white text, `9px` radius
- Secondary: transparent bg, `var(--accent)` text + 1.5px border
- Ghost: bg `var(--surface2)`, text `var(--text-muted)`, border `var(--border)`
- Disabled: primary style at `0.4` opacity
- Buttons are flex containers (global `display: inline-flex` in
  `index.css`), so `textAlign` has no effect on their contents — to
  centre a button's icon/label use `justifyContent: "center"`
  (icon-only or full-width buttons need this explicitly; the default is
  left-aligned)

## Inputs
- Border `var(--border)`, `9px` radius, `9px 12px` padding, Nunito 13px

## Toggles
- Off: track `var(--border)`; On: track `var(--accent)`; thumb white, 16px circle
- Track `38 × 22`, radius `11`, `3px` padding — that keeps an even 3px
  inset around the 16px thumb on all four sides. On = `translateX(16px)`.

## Icons
- No emoji anywhere in the UI — use flat line-icon glyphs from
  [`lucide-react`](https://lucide.dev) instead (`import { X } from
  "lucide-react"`).
- Default size `14` for inline button/control icons, `18–20` for larger
  decorative icons (feed rows, feature cards). Default `strokeWidth` is
  fine (2) — don't fill shapes, keep the flat/line look.
- **Actionable elements** (inside a `<button>`, `<a>`, or a `<label>`
  wrapping a file `<input>`) — pass `color="var(--accent)"` explicitly.
- **Decorative/status icons** (feed rows, static feature cards, inline
  status text) — don't set `color`; let it inherit `currentColor` from
  the parent, *except* icons standing in for a semantic status (success/
  error/warning), which should carry that meaning explicitly:
  `color="var(--green)"` / `var(--red)` / `var(--yellow)`.
- Plain typographic characters in prose (e.g. a `→` inside a sentence
  explaining a multi-step flow) are not icons — leave those as text,
  don't turn them into SVGs.
- `<option>` elements can't render SVG children — icon-ify the label
  text next to the `<select>` if needed, not the option text itself.
- The global `button` rule in `index.css` is `display: inline-flex;
  align-items: center; gap: 6px`, so `<button><Icon size={14}/> {label}</button>`
  aligns on its own — no wrapper span needed inside a `<button>`. `<a>`
  and non-button decorative wrappers don't get this for free; add
  `display: "inline-flex", alignItems: "center", gap: 6` (or 4 for tight
  status text) to that element's own style when pairing icon + text.

## Notes for future visual changes
- Prefer adding/adjusting a CSS var in `index.css` over hardcoding a hex
  value in a component — every themed color should flow through a token.
- `--on-accent` is white in both themes (works against the pink accent);
  don't reintroduce a dark on-accent color without checking contrast.
- Keep dark/light/`prefers-color-scheme` blocks in `index.css` in sync —
  there are three copies of the token list by design (explicit dark,
  explicit light, and the OS-preference fallback).
