# fribblr theme: the locked reference

This folder is the reference for fribblr's theme. `approved-2026-11-18/` is a frozen
record of what Elena approved; do not edit it. When the theme changes on purpose,
add a new dated folder and say here what changed and who approved it.

## What was approved (2026-11-18)

The round 3 mockup: the real app under a replacement stylesheet.

- `approved-2026-11-18/tokens.css`  the token set, by role (ground, surface, ink, palette, depth, shape, type)
- `approved-2026-11-18/theme.css`   the mockup stylesheet (an override sheet, not the implementation)
- `approved-2026-11-18/theme.js`    the mockup script for the kind legend, kind sides and shortcut keycaps
- `approved-2026-11-18/NOTE.md`     the design note: colour jobs, depth rules, decisions
- `approved-2026-11-18/contrast.md` WCAG and APCA for the main pairs
- `approved-2026-11-18/shots/`      the screens she saw
- `approved-2026-11-18/figures/`    depth heights, the squircle corner, and three ideas for later

Her words on approving it: "this is excellent".

## Amendments she made when approving (binding, and not yet in the frozen files)

1. **Stronger 3D.** The slab's side was weakened between round 2 and round 3 and "should go back to
   being the stronger version". The strength reference is round 2's Unified theme:
   `shots/depth-reference-unified-*.png` and `depth-reference-unified-tokens.css`.
   "we've gotta make sure that we implement the 3d feel well and in a way that can be expanded upon
   cleanly in the future."
2. **Ground toggle.** "give a toggle to change between the blue background and a flat white one."

## What she asked the theme to be

"a very nice mature-but-playful theme that puts board content first, while making the space
comfortable to use". Earlier: "rounded controls are a must-have to prevent it from looking cookie
cutter"; "i imagine a future where we play into the semi-3d nature".

## Status

The implementation in the app replaces the override sheet. Once it lands, the app's own token file
is the live source of truth and this folder stays as the record of intent.
