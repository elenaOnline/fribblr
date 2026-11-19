# How fribblr surfaces are wired to UI SDK

Experiment branch `ux-sdk`. UI SDK (`@ui-sdk/web`, Apache-2.0) is vendored unmodified in `vendor/ui-sdk/`
(browser build, relative imports only; docs in `vendor/ui-sdk/docs/`, start at `docs/llms.txt`). No build step,
no npm dependency. The SDK supplies behaviour (keys, focus, dismissal, placement, ARIA); the look stays fribblr's.

## The pattern

1. **Import the entry** for each component a surface uses, at the top of the module that builds the surface:
   `import "./vendor/ui-sdk/web/menu.js";` (relative to `public/`). Don't use the autoloader (`web.js`): it upgrades
   tags asynchronously after insertion, so code that reads `.api` right after inserting races it. Before touching
   `.api` or setting properties, `await customElements.whenDefined("ui-menu")` (helper: `defined()` in `ui-sdk.js`).
2. **Wrap our own elements.** Parts are light-DOM custom elements. Triggers and Close parts wrap our existing
   `<button>` and are `display: contents`; behaviour, ARIA and `data-*` state land on the button. Keep the existing
   classes on our elements so the theme's CSS still applies. Use `as-child` to make another part bind its first child.
3. **Style from tokens and the depth model, never from the SDK.** Don't link `vendor/ui-sdk/web.css`. Popup content
   floats: give it `data-height="float"` or an existing float class (`depth.css` lists them). Keys stay raised.
   State styles key off the SDK's attributes (`data-open`, `data-highlighted`, `data-checked`, `data-pressed`,
   `data-disabled`, `data-side`), never generated ids. `ui-sdk.css` is linked first on every page and declares
   `@layer ui-sdk;` so every rule of ours wins over the SDK's few defaults. Do not edit `tokens.css` or `depth.css`.
4. **Board keys step aside.** The board's capture-phase key handlers call `widgetOwnsKey(event)` (`ui-sdk.js`): a
   focused menu, listbox, tree, combobox or dialog owns every key (typeahead letters, Escape); a focused toolbar,
   radio group, tab list, slider or resize handle owns the navigation keys. Any new board-level key handler must
   check it too.
5. **Popup events bubble** to the elements around them (`docs/popups.md`). Keep popup content outside cards and
   other clickable containers, or the card hears the click.
6. **Change events don't bubble** and are cancelable (`openchange`, `valuechange`, `pressedchange`, …). Listen on
   the element. Setting a property fires no event, so writing our model back into an element never echoes.
7. **Undocumented globals** (toast, shortcuts) are reached only through `ui-sdk.js`, so a version bump is a
   one-file check.

## Collections: a Core primitive around markup we already draw

A collection (Home's boards today; the canvas's cards could follow) has no shipped element to wrap: `ui-listbox`
options would replace our cards, and its plain click toggles where ours opens. So the behaviour is built from Core
helpers in one primitive and rendered with `createParts` (SPEC A3, B5 § 0). The pattern, from `home-board-list.js`:

1. **One primitive, two slots.** `definePrimitive({ name, options, controlled: ["value"], state, sync, api, slots })`.
   `api` composes `createRovingFocus` (one Tab stop; `move` for the layout), `createSelection` (multiple; the anchor),
   `createTypeahead` and `createFocusRecovery`. The `root` slot declares the role (`listbox`) and handles `keydown`;
   the item slot declares `role: "option"`, `focus: "roving"`, writes `aria-selected` and the roving `tabindex` in
   `attrs`, and binds roving focus and recovery in `bind`. Roles go on the slot, never in `attrs` (core.md § Roles).
2. **Thin wrappers.** `createParts(primitive, { root: { tag, display: "contents", api: [...] }, item: { tag, display:
   "contents", target: el => el.querySelector(".our-focusable") } })`. The item part binds the element that should own
   focus and keys (the card's own link), so the focus ring, Enter and a plain click stay native. The wrappers are
   `display: contents`, so the grid lays out our cards as before. Custom tags are `fr-*`.
3. **Controlled selection.** Our code owns the selected set. It sets `root.value = [...]` (no event) after every change
   of its own (marquee, clear, re-render), and listens for `valuechange` (non-bubbling, on the root) to take the
   changes the primitive asks for from keys and presses. Pointer gestures the SDK doesn't map (modifier clicks, a
   select circle) call the root's exposed `api` methods, so the anchor stays the primitive's.
4. **Re-rendering.** `reconcileChildren` keeps an element bound when its key matches. It now leaves alone the
   attributes a bound part manages: an element carrying `data-slot` that our fresh markup doesn't write keeps the
   attributes our markup doesn't mention (role, tabindex, aria-selected, data-slot). So never write a part-managed
   attribute (`tabindex`, `aria-selected`, `role` on a bound element) in render markup; write only what is ours.
5. **Wrappers in markup.** The root stays the same element across renders (render it every time, empty or not), so
   the instance and its Tab stop survive live updates. Anything that isn't an item (an empty-state line, a "New"
   card) sits beside the root, not inside it, so the role's children stay options.

## Surfaces

Each surface lists its files and the SDK components it uses. Added as surfaces land.

### Home: the board grid and its selection

Files: `home-board-list.js` (the primitive and its parts), `workspace-home.js` (render, pointer gestures, the bar),
`reconcile.js` (keeps part-managed attributes). Core: `definePrimitive`, `createParts`, `createChange`,
`createRovingFocus`, `createSelection`, `createTypeahead`, `createFocusRecovery`, `isTypeaheadKey`, `matchesShortcut`.
Applies to the organized Home (`WorkspaceHome`); the legacy shelf in `home.js` (organization not enabled) is unchanged.

- **Markup:** `fr-board-list[aria-label=Boards]` (role `listbox`, `aria-multiselectable`) > `fr-board[value=itemId]` >
  `article.board-card[role=none]` > `a.board-link` (role `option`, `aria-selected`, roving `tabindex`, named by the
  board title through `aria-labelledby`, described by its description and dates). The select circle is
  `tabindex=-1 aria-hidden=true`: a pointer affordance; the option carries the state.
- **Keys:** Tab enters once, on the board focused last (first selected, else first, before that); arrows follow the
  grid as the window lays it out (Left/Right in reading order, wrapping at row ends; Up/Down by column, measured on
  the key press; Down from a column with nothing below goes to the last board; no wrap past either end); Home/End and
  Ctrl/⌘+Home/End go to the first/last board; typing finds a board by title (500 ms runs, as the SDK's typeahead);
  Space toggles (Shift+Space: range); Shift+arrows, Shift+Home/End extend from the anchor; plain moves carry the
  anchor along (core.md § Ranges and Select All); ⌘A selects all and again clears (also with focus outside the grid,
  not in a field); Enter opens (native link); Esc clears (not in a field: the find field's Esc is its own); `/` still
  goes to find.
- **Pointer:** a click opens the board; ⌘/Ctrl-click (and macOS Ctrl-click's context menu) toggle one board;
  Shift-click selects the range from the anchor in grid order (with no anchor it starts there); the circle toggles.
  A press moves focus to its board without scrolling. The marquee is unchanged (not the SDK lasso: `createLasso`
  changes the selection once on release, ours is live, and it has no page-scroll story).
- **Not the SDK's Listbox component:** `ui-listbox` arrows wrap and a plain click toggles in multiple mode; here a
  click opens a board, and a 2-D grid doesn't wrap top to bottom. Escape clearing the selection is the app's
  existing behaviour (the SDK's selection helper maps no Escape; Listbox leaves the selection alone).

### Navigator (⌘K, `/`, the header toggle, Find boards and items, the reader's toggle)

Files: `navigator.js`, `navigator.css`; openers in `canvas.js` (`#chrome-search`, `#reader-search` and `#reader-navigator`
pass themselves as the opener). Components: Dialog, Command, Tree, Select.

- **Panel: a non-modal `ui-dialog`** (`modal="false" close-on-outside-press`), content `#project-navigator` with
  `inline` so it keeps its fixed place, its z-index and its float look instead of moving to the top layer. Opened from code
  (`api.open()`); focus goes to the field (`initial-focus`, or `none` when the docked panel opens on page load) and
  returns on close to the opener (`final-focus="#id"` for a button, otherwise the element focused before, the SDK's rule).
  Escape closes only while focus is inside; Tab can leave and it stays open. Docked ("Keep open"), the dialog gets
  `dismissible="false"`: Escape and click-away are refused, and the `dismissattempt` for Escape moves focus to the
  toggle. A press on a toggle or a Find button is not a click-away: `openchange` with reason `outside-press` from those
  is cancelled, and their own click toggles or focuses the field. Close (`ui-dialog-close`) also un-docks. On close the
  slide-in animation is finished, because the SDK otherwise keeps a closing popup until its animations end.
  `tinka:navigator-open` takes `detail.opener`.
- **Field and results: `ui-command filter="false"`.** The server filters, so the query goes to `/api/search` after a
  150 ms pause, with stale requests aborted; the previous results stay until the next arrive (status line and the
  command's `status="loading"` say "Searching…"). The caret never leaves the field: arrows move the highlight
  (`aria-activedescendant`), Home/End move the caret, Enter runs the highlighted result, Escape empties the field and
  then closes. Enter typed before the results arrive runs the first fresh result. Each result is a `ui-command-group`
  (title, kind and description are its label) holding one `ui-command-item as-child` link per place it can be opened.
  Links (results, Recent, board rows) navigate through the panel's click handler (`follow()`, which saves feedback first);
  the SDK's Enter clicks the link, so both paths meet there. Our status line announces counts, so
  `command.announcement` returns null. Marks ignore case and accents (`fold()` in `navigator.js`); the server's own
  matching ignores case only (`lib/discovery.mjs`), not accents.
- **Recent** boards are command items while the field is empty (the SDK's `emptyItems` idea, rendered as markup): ↓ and
  Enter reach them without leaving the field. The highlight shows only while the field has focus.
- **Boards and On this board: two `ui-tree`s**, each one Tab stop; the section band is the root item, so → / ← open and
  close a section, and its open state is saved as before. Boards is `mode="none"` with `current` (the current board gets
  `aria-current="page"`); rows are links (`ui-tree-item-label as-child`). On this board is `mode="multiple"` and mirrors
  the board's selection as `aria-selected` (`tree.value` set from `tinka:selection`); every `valuechange` is cancelled,
  and choosing a row (`action`) selects it on the board through `reveal`. Regions are branches. Both trees use
  `expand-on-press="false"` and toggle bands and regions in `action`. The SDK manages a tree item's `style` attribute
  (`--tree-level`), so nothing else may be set inline on `ui-tree-item`. The browse container stops keydown from
  reaching the Command root around it.
- **Scope: `ui-select`** with a `tk-menu` list (press, drag to a choice, release; typing on the closed trigger changes
  the value). Hidden on Home, where only Whole project applies.
- **Shared fix in `canvas.js`:** the board's document click handler opened a card for any `[data-open]` element, and
  `data-open` is also the SDK's open-state attribute on triggers, so opening the scope Select opened the board owner's
  reader. It now skips elements with `data-slot`. Every surface with an SDK trigger on a board page needs this.
