# Spec Check design system

The panel matches the host. All surface colors derive at runtime from
Premiere's `appSkinInfo.panelBackgroundColor` (CEP), so the panel follows
the user's Premiere brightness setting. The values below are the derivation
rules plus the darkest-skin reference rendering.

## Color derivation (from host background L)

| Token | Rule | Darkest-skin reference |
|---|---|---|
| --bg | host panel background, verbatim | #232323 |
| --surface | bg lightened ~4% | #2a2a2a |
| --inset | bg darkened ~4% (meter tracks, log) | #1b1b1b |
| --line | bg lightened ~11% (hairlines only, 1px) | #3d3d3d |
| --text | high-contrast neutral | #d6d6d6 |
| --dim | ~55% text | #8f8f8f |
| --accent | Premiere selection blue, actions + focus only | #2d8ceb |
| --pass | desaturated green, verdicts only | #56a865 |
| --fail | desaturated red, verdicts only | #d4593f |

Restrained strategy: accent on the primary action and focus rings only.
Pass/fail color appears only on verdict dots, chips, and meter markers.
Never on backgrounds of large regions.

## Typography

Segoe UI stack, 11px base, fixed rem-free pixel scale (panel DPI is
host-controlled). Section labels: 10px, uppercase, +0.08em tracking, --dim.
Measured values and ranges: Consolas 11px. No display fonts. Weight
contrast (600 vs 400) does hierarchy; size stays tight.

## Structure vocabulary

- Hairline row separators, not cell borders. No full-grid tables.
- Sections separated by whitespace + uppercase labels (Premiere idiom).
- Controls: flat, 1px --line border, 3px radius, --surface fill; hover
  brightens border; focus shows a 1px --accent ring; disabled drops to
  50% opacity.
- The scoreboard is the hero: each checked metric renders a range meter,
  a horizontal --inset track with the allowed band marked and a 2px
  marker at the measured value (marker carries the pass/fail color).
- Verdict line: colored dot + sentence ("Passes Apple Podcasts",
  "2 checks failing"), not a filled banner.
- Log: --inset strip, Consolas 10px, --dim; errors in --fail.

## Motion

State feedback only: 150ms ease-out on hover/selection, meter marker
eases into position on preset switch. Nothing on load.
