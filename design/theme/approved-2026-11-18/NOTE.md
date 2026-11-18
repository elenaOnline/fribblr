# Round 3: one theme

The board is a blue-grey desk, and everything on it that you can pick up is a white slab standing on that desk. A slab's lower side is the colour of what it is: teal for pages, violet for documents, green for pictures, the desk's own grey for notes, a deeper desk grey for a whole board. Things you press are smaller raised keys; fields sink in; menus and dialogs float above in a light grey frame. The agent's work is black, and everything Elena said on the board is one red.

## What came from which parent

From Alabaster + Modus:

- The base and surfaces, value for value: white paper, the #F2F2F2 frame (header, inspector, menus, dialogs, the thread card), #E0E0E0 hairlines, #C8C8C8 seams, #9F9F9F float edges, black ink, #595959 grey, and the #DAE5EC well as the desk under every board, the reader and Home.
- The squircle shapes for controls and surfaces, now drawn as true squircles (CSS `corner-shape: squircle`), with Modus's round corners as the fallback.
- How menus present: frame grey, a 1 px edge, one soft shadow, comfortable rows, a blue-grey chosen row, hairline sections, and the shortcut printed at the end of a row.
- #005E8B blue as the single accent: on, selected, focused, the primary key.
- IBM Plex: serif for names, sans for controls and card titles, mono for numbers.
- Her voice as one colour, and danger with no colour.
- Keys that print their shortcut.

From Unified:

- The 2.5D slab: a white face with a coloured lower side and a short cast shadow, one light from above.
- The small palette, kept at its saturation and value (OKLCH L .70, C .115) and re-tuned for the desk.
- Kind colour as material on the slab's side; state as a mark, never a tint on the slab.
- The kind legend in the foot of a board, and the kinds line under each board on Home.
- "A key stands up and a field sinks in."

## The colour jobs

Five colours. Marks are deep and carry state; material is mid and carries kind.

- **Blue #005E8B (mark):** on, selected, focused, the primary key, links in documents.
- **Red #B33830 (mark):** her voice. Her comment pins, her messages in a thread, the text she types into a reply or a review note, her stars and votes, the note dot, the count of her open comments.
- **Teal #1DB4B4 (material):** pages: HTML, live apps, links.
- **Violet #AF8CD8 (material):** documents: Markdown, PDF.
- **Green #6FB171 (material):** pictures: images, video, audio.
- Notes and ideas have no hue: their side is #B3C0C8, a light piece of the desk. A child board's side is #647F8F, a deeper piece of the desk.

How the palette was re-tuned. Unified's three kind colours sat at L .70, C .11 on white beside navy ink. On the desk (hue 235) teal at hue 200 leaned into the ground and into Modus blue, so it moved to hue 195; green moved from 148 to 145 to stay apart from teal; violet stayed at 305. Chroma rose slightly (.11 to .115) because a cool ground takes some colour out of cool hues. Every side has a contour one step darker (L .48), which is what makes the side read as an edge at 4.9 to 5.3:1 against the desk.

Starred is no longer gold: a star is something she said, so it is red. That removed a hue. Unified's raspberry and Modus's brick were the same job; the red is between them, warmer than raspberry so it stays apart from violet, a little brighter than brick so it sits in the same range as the palette.

## The depth rules

One light, from above and slightly in front, so only the lower side of a thing shows, and shadows fall straight down.

Heights:

- **Sunken (-1):** fields, segmented tracks, the search key in the bar, a board's cover. A 1 px shade along the top inner edge.
- **Flush (0):** the desk, the header bar, side panels, text and regions drawn on a board.
- **Raised (1):** keys, comment pins, the chosen segment, printed keycaps, the selection corner. A 2 px lower side.
- **Slab (2):** cards on a board, the item in the reader, boards on Home. A 6 px lower side in the kind's colour and a short cast shadow on the desk.
- **Float (3):** menus, dialogs, the thread card, the bars over the board. No side, a soft shadow below: a float is held above the desk, not standing on it.

What is which: what you can pick up is a slab; what you can press is raised; where you type sinks; what appears over the work floats; the ground and the chrome are flush.

How height changes, only in direct response to her pointer:

- **Hover:** no change in height. A slab's rim darkens; a key's rim and side darken. On a dense board the pointer crosses dozens of cards, so nothing rises.
- **Press:** a key drops 1 px onto its side; a pressed comment pin loses its side.
- **On:** a key that is on stays down, tinted blue, with a blue rim.
- **Select:** a slab does not move. A blue line is drawn on the desk around the whole slab, side included (8 px out).
- **Drag:** while she holds it, the slab rises 4 px: its side lengthens by 4 px and its face moves up by 4 px, so the side still ends where it stood, and the cast shadow lengthens. It comes down when she lets go.
- **Not built yet:** a placeholder has no side, only a dashed footprint.

How the side is drawn on a squircle corner: the side is the face's own outline moved straight down by the depth, filled with the kind's colour, with a 1 px darker contour. Because it is the same curve, the corner of the side runs parallel to the corner of the face, and the slab reads as one extruded piece rather than a card with a shadow. Keys draw their side inside their own box (a lower lip), because the app's header keys carry a transparent hit border that an outside side would float beyond.

## Decisions on the parts nobody mentioned

- **Red as her voice:** kept. It is the clearest single job a colour does on this board, and folding stars into it removed gold.
- **Uncoloured danger:** kept. A red "Remove" would read as something she said; destructive rows stay ink, alone in the last section of a menu.
- **Printed shortcut keycaps:** kept, now as tiny raised keys. They teach the keyboard at the place you click; hidden on touch and at phone width.
- **IBM Plex over Space Grotesk:** Plex. It is part of the Modus menus and surfaces she liked, and its serif names give the "mature" half; the playful half comes from the slabs and colours.
- **Mono only for numbers:** narrowed. Modus set labels, dates, status words and meta in mono; here mono is for counts, shortcuts, the zoom value and thread times, and labels are plain sans, which reads calmer over an hour.
- **Registration crosses:** dropped. Their job on white paper was to give slabs something to stand on; the desk colour does that now, and a plain ground keeps the content loudest. The board's own Dots and Grid settings are left on, tinted to a deeper desk tone (not shown in these screens).
- **Kind colours on the slab side:** kept, as the theme's main use of colour.
- **Kind words on cards (HTML, DOC, IMAGE):** dropped. On the 84-item board they are 84 extra words competing with the items' names; the side carries the kind, the legend names the colours, and pointing at a legend entry lights that kind.
- **Kind legend:** kept, with a tiny slab as each swatch.
- **Lettered comment points (Latin Modern initials):** dropped, with that fourth typeface. A comment pin is a raised red key carrying her initial in Plex, which fits the rule that what you press is raised.
- **Pills versus squircles:** squircles, as she chose. Only things whose circle is the mark stay round: pin heads, the selection corner, status dots.
- **Navy child boards:** changed. A whole navy slab was the loudest object on any board; a child board is now a white slab on a deep desk-grey side, with its cover sunk into the face as a window onto its own desk.
- **Home:** moved onto the desk too, so a board on Home is the same slab as a child board on a board.

## Where depth can go next

Not part of the theme; three directions to react to. Each is drawn in the figures beside this note.

1. **A board you can open is a stack.** An item with a child board shows extra sheets under it, one per few items inside, so you can see how much is in it before opening it.
2. **Drag lifts further, and a board you can drop into sinks.** The held card rises more and leaves a dashed footprint; a board that will accept it opens as a well in the desk while she is over it.
3. **Groups are trays sunk into the desk.** A group or region is cut into the desk instead of drawn on it; a group inside a group is cut deeper. Cards stay at slab height everywhere, so depth means "inside", not importance.

## Contrast

All text pairs pass WCAG AA; see contrast.md and the table on the mockup page. The kind sides are 2.0 to 2.2:1 against the desk, under the 3:1 for non-text, so kind never rests on the fill alone: each side's contour is 4.9 to 5.3:1, and the legend names the colours.

## Not designed

Dark mode. The whiteboard's sticky and region colours, which the app hard-codes. Kinds are not in the app's DOM; theme.js reads them from the board API, as round 2 did.

## Rebuild

The screens come from a sandbox copy of the fribblr instance's boards (sandbox/, port 47410): `node fribblr/cli.mjs start --config design/theming/r3/sandbox/config.json`, then `node design/theming/r3/tools/capture.mjs all`, `node design/theming/r3/tools/figures.mjs`, `python3 design/theming/r3/tools/build_page.py`. Stop the sandbox with `stop` in place of `start`.
