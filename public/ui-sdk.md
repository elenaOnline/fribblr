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
   card) sits beside the root, not inside it, so the role's children stay options. A wrapper never repeats an
   attribute of the element it wraps: an item wrapper needs its own re-render key (`fr-board[data-home-entry]`, a
   key `reconcileChildren` knows), or every `[data-home-board=id]` query finds two elements.

## Popups: menus and popovers

Every menu and popover follows one pattern, in `popups.js` (helpers) and `popups.css` (looks; linked last on
`board.html` and `home.html`). Follow it for any new popup.

- **Menu or Popover.** A list of actions or choices is a `ui-menu` (plain, checkbox and radio items, groups,
  separators). Anything holding a field, a slider or a segmented control is a `ui-popover` (menu.md § Keyboard
  Navigation: a menu holds items only). A colour choice in a menu is an item that opens the system picker.
- **Where content lives.** A popup's root and content sit at the end of `<body>`, never inside a card, a toolbar or any
  clickable container: popup events bubble to their DOM ancestors. Inside the reader (a modal `<dialog>`, which makes
  the rest of the page inert) popups live in the dialog: `sharedMenu({host: dialog})`.
- **Triggers.** A fixed button reaches its popup with `<ui-menu-trigger for=id>` / `<ui-popover-trigger for=id>` around
  our button (inside a toolbar: `<ui-toolbar-button><ui-menu-trigger for=…><button>`). The SDK then writes
  `aria-haspopup`, `aria-expanded`, `aria-controls`, opens on click / Enter / Space / ↓ / ↑ and returns focus. Don't
  write those attributes or a click handler yourself. A button that is rebuilt with its container (a card's ⋯, a
  drawn-object bar) and every point-anchored context menu open the popup from code: `openMenu(root, {anchor, event,
  payload, returnTo})`. `anchor` is the element, an `{x, y}` point, or an object with `getBoundingClientRect()` (use
  that when the button may re-render while open). `returnTo` is a selector that finds the opener again after a
  re-render; focus goes back there on Escape, a choice, or Tab. `openFocus(event)` gives the SDK's rule: a keyboard
  open focuses the first item (↑: the last), a pointer open focuses the menu itself.
- **One menu, many openers.** One shared menu element serves every card (`payload` = the card's placement id, read
  with `api.getPayload()` in the `action` handler). Fill the content just before `api.open()`.
- **Menu buttons in a toolbar** open on ↓ (`openOnArrowDown(toolbar, selector, open)`), the toolbar norm.
- **Context menus.** Our own `contextmenu` listener calls `openMenu` with the pointer; Shift+F10 / the context-menu key
  are handled as keys (macOS fires no `contextmenu` for them). A second right-click re-anchors: the first press closes
  the menu (consumed), the `contextmenu` that follows opens it at the new point.
- **The consumed press.** Menu's default `modal="pointer"` swallows the outside press that closes it, but only its click:
  the `pointerdown` still reaches the board, which would select or drag the card under it. Every menu made with
  `sharedMenu()` (or passed to `guardMenu()`) records that press, and a document capture listener in `popups.js`,
  registered before the board's, stops it. Board handlers that run on `window` capture (before the SDK) check
  `menuOpen()`.
- **Keys.** The board's capture-phase Escape ladders and command keys step aside for an open popup: `widgetOwnsKey()`
  (`ui-sdk.js`) for command keys, `inPopup(event)` (`popups.js`) for handlers that must keep their keys in our other
  dialogs (the Inspector is `role=dialog`). Letters inside a menu are typeahead, never board shortcuts.
- **Looks.** Content gets `.tk-menu` (the menu face and the float height in `depth.css`); items keep `.tk-mi`,
  separators `.tk-msep`, group labels `.tk-mlabel`. `popups.css` removes the UA popover box Menu content keeps, lights
  the highlighted item from `data-highlighted` (`:hover` alone no longer does, so pointer and keys never light two rows),
  draws no focus ring on menu items (the fill is the indicator, as in native menus), and shows checks from
  `data-checked`. Where an old class set `display` or `position` on the hand-rolled popup, `popups.css` puts back
  `revert-layer`, or a closed popup would show. Shortcut hints are keycaps: `menuItem(value, label, {shortcut:"mod+d"})`
  writes `aria-keyshortcuts` and a `<kbd class="tk-kbd">`.
- **SDK gaps found (0.1.0-beta.10).** (1) An item's `shortcut` attribute sets `aria-keyshortcuts="Control+…"` on a Mac
  while its hint reads ⌘, so we write both ourselves. (2) `final-focus` on menu content is ignored for a menu opened
  from code: focus returns to "the element focused before", so `openMenu` focuses the opener just before opening.
  (3) A Popover trigger does not open on ↓; the toolbar norm is added by `openOnArrowDown`.
- **Hazard for every stream:** SDK parts carry a `data-open` state attribute. The app's `[data-open]` (open this item)
  selectors must exclude SDK parts: `[data-open]:not([data-slot])` (fixed in `canvas.js`).

## Restyle cost: keep whole-board restyles rare and cheap

Pan, zoom and drag on a dense board (`showcase-dense`, ~3,000 elements in `#viewport`) are bound by style recalc.
Two things keep it cheap; re-check both on an SDK upgrade or a canvas change (probes: `team/ux/perf/`).

- **The SDK's default-display rules (workaround for `@ui-sdk/web` 0.1.0-beta.10).** For every element defined with a
  default display, the SDK writes `:where(TAG:not([hidden]), TAG[hidden="until-found"]) { display: contents }` into
  `<style id="ui-sdk-web-N">` (about 70 rules on a board page). What it does: the wrappers (triggers, toolbar parts,
  `fr-*` collection parts) take no box unless hidden; `hidden="until-found"` keeps them findable. Chrome can't bucket
  a two-argument `:where()` by its tag, so all of them were tried against every element on every recalc: each
  whole-board restyle cost ~30% more (wheel event 11 → 15–19 ms). Bisected rule by rule in a headless page; the other
  injected rules (`[data-slot][hidden]`, popover reset, `[as-child]`, `[align]`, and `[data-mirror]` with its
  `:dir(rtl)` flip) cost nothing measurable. `ui-sdk.js` (`watchSdkStyles`) rewrites each to
  `:where(TAG):where(:not([hidden]), [hidden="until-found"])`: the same match at the same specificity (0), with the
  tag bucketable. A `MutationObserver` on `<head>` re-applies it whenever the SDK regenerates the sheet (each newly
  defined element). The vendored files stay unmodified. Not covered: the same rules adopted into shadow roots (we
  have none with SDK parts). On an upgrade, check whether `Zr()` in `web/chunks/C59yJGP2.js` (or its successor) still
  writes that shape; if it changed, the regex no longer matches and the cost may be back.
- **The `[data-mirror]` rule** (`:where([data-mirror][aria-hidden]:dir(rtl)) { scale: -1 1 }`) flips directional icons
  in right-to-left text. fribblr is left-to-right only; it was not the cost and is left alone.
- **Pan writes only non-inherited properties on `#viewport`.** `canvas.js` registers `--pattern-x` / `--pattern-y`
  (`CSS.registerProperty`, `inherits: false`): only `#viewport`'s own background reads them, so a pan frame restyles
  `#viewport` alone (0.1 ms) instead of every element under it (11 ms). This predates the SDK work and is a fix
  upstream Tinka could take. Any property written on `#viewport` per frame must either be registered non-inherited
  or not be written per frame; `--canvas-zoom` and `--chrome-scale` are read by cards and change only on zoom.
- **No per-frame view animation on input paths.** Keyboard reveal moves in one step (above); a glide that calls
  `applyView` every frame is only for app-chosen moves (Fit, round steps).

## Surfaces

Each surface lists its files and the SDK components it uses. Added as surfaces land.

### Toasts, dialogs, confirmations, notes popover, Quick jot (overlays stream)

Files: `toasts.js`, `workspace.js` (`makeDialog`, `confirmDialog`, re-exports `toast`), `agent-prompt.js`,
`update-notice.js`, `home.html` + `home.js` (the new-board dialog), `tile-ui.js` (`TileNotes`), `quick-jot.js`, `comment-pins.js` (send-prompt dialog),
`workspace-board.js` / `workspace-home.js` (confirmations);
CSS in `workspace.css` (`.workspace-toasts`, `.workspace-toast`, dialog backdrop, `.workspace-alert`), `home.css`,
`update-notice.css`, `whiteboard.css`.

- **Toast** (`ui-toast-region` + the default toaster). `toast(message, options)` from `workspace.js` is the only call
  site API; it stays synchronous and returns the toast's id (`dismissToast(id)` closes it). `toasts.js` builds one
  region per page on first use (bottom centre, where the old status node sat) with a close button and an action slot;
  duration is kept at 6 s. Live status regions that are not toasts (connection, form status) are untouched. Tests find
  toasts by `.workspace-toast`; several can be on screen at once, so use `.first()`/`.last()`/`filter`.
- **Dialog** (`ui-dialog`, modal). `makeDialog(title, body, onSubmit, {opener, compact, shortcutHint, onDismiss, className})`
  keeps upstream's 1.3 signature and footer (the submit key and its hint go in `footer.workspace-dialog-actions`): it returns the
  `ui-dialog-content` element (class `workspace-dialog`), which has `close()` and fires a `close` event once closed.
  `onDismiss(form)` runs when the dialog closes without saving. A dialog that has it keeps its draft (the new-board dialog),
  so it never asks "Discard your changes?". `opener` is where focus goes back on close (default: the focused element).
  Focus opens on the first field (`autofocus` is set on it), else the close key; Tab wraps; Escape and a press on the
  backdrop close; focus returns to what had it. A form with typed-in changes asks "Discard your changes?" (an alert
  dialog) before Escape or the backdrop throw them away; the × key never asks. ⌘↩ still saves (`bindForm`). A dialog
  opened over another dialog, or over the reader's native modal `<dialog>`, is appended inside it, otherwise the
  parent's inert page would include it.
- **Alert dialog** (`ui-alert-dialog`). `confirmDialog({title, description, confirmLabel, cancelLabel, onConfirm})`
  resolves true for the confirming answer. Focus opens on Cancel, Escape means no, a backdrop press does nothing.
  `onConfirm` (async) keeps the dialog open with the confirm key pending and shows a failure inside it. Used for
  Remove placements (its toast has an Undo action that runs the same undo as the shortcut), Remove from home,
  Archive/Restore everywhere, Enable flexible boards, and the discard question above.
- **Agent prompt, update consent, Home's legacy new-board dialog, the comments send-prompt dialog**: the first three are
  `ui-dialog` built by hand with their own classes (`agent-dialog`, `update-dialog`, `#new-dialog`); the update dialog
  starts on Later (`autofocus`), the agent prompt in its text. The send-prompt dialog is `makeDialog` with no submit.
  Home's graph "New board" dialog is `newBoardDialog` (`makeDialog`, compact).
- **Tile notes** (`TileNotes`): `ui-popover` (non-modal) in the body, anchored by a temporary
  `data-note-anchor` attribute on the opener, so card handlers never hear it. Saving holds it open; Escape, a press
  outside, Tab out and × keep the draft; Cancel drops it. Focus returns to the opener control.
- **Quick jot**: a non-modal `ui-dialog` (a persistent bar, the board stays usable around it); Escape closes it from
  inside and focus returns to where it came from.
- **Gotcha: `data-open`.** The SDK marks every open popup with `data-open`, which the app already used for its own
  card openers (`data-open="<key>"`). Document-level handlers must ask for `[data-open]:not([data-slot])`
  (`canvas.js` click handler, `board-document.js`); a bare `closest('[data-open]')` treats any click inside a popup as
  "open that experiment".
- **Gotcha: open-dialog checks.** Code that asked `document.querySelector('dialog[open]')` now also asks
  `ui-dialog-content[data-open][aria-modal=true],ui-alert-dialog-content[data-open]`; code that asked
  `dialog.workspace-dialog[open]` asks `.workspace-dialog:is([open],[data-open])`. The `aria-modal` part matters:
  the Navigator and Quick jot are non-modal `ui-dialog-content`, and must not pause the board (the SDK writes
  `aria-modal="true"` only on modal dialogs).

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

### Toolbars, segmented controls and toggles (`ux/toolbars`)

Shared files: `ui-segmented.js` (segmented-control helper), `ui-toolbar.js` (`followVisibility`), the toolbar/segmented
rules at the end of `ui-sdk.css`.

- **Segmented controls** (`ui-segmented-control`): Home sort (`home.html`, `home.js`), board Inspector Layout and
  Pattern, item Inspector appearance (`workspace-board.js`), Appearance rows (`appearance.js`), Tinka updates policy
  (`update-notice.js`), the reader's Version (`canvas.js`), and the `.tk-seg` markup inside the zoom menus (`board.html`:
  Pattern, Window, Light). A radio group: one Tab stop on the checked item, arrows check as they move, the control is
  named by `aria-label` or `aria-labelledby`. `segmentedHTML()` builds the markup, `setSegmented()` writes our model
  back (no event), `onSegmented()` runs a callback when she chooses. The items are the SDK's own elements, not buttons, so
  the theme's `.tk-seg > button` rules (`tokens.css`, `depth.css`) don't reach them: `ui-sdk.css` repeats them for
  `.tk-seg > ui-segmented-control-item` keyed on `data-checked`, and the app's own css files list both selectors. No
  `ui-segmented-control-indicator` is used: the raised cell is the item's own face, so nothing slides.
  `valuechange` doesn't bubble but does pass the capture phase: `canvas.js` hears Pattern, Window, Light and Version
  from one capture listener on `document`, so every copy (zoom menu, Inspector) stays in step.
- **Toolbars** (`ui-toolbar`, items in `ui-toolbar-button`): selection bar (`workspace-board.js` `selectionMenu`), the
  two zoom pills and the comment bar (`board.html`, `comment-pins.js`), the whiteboard object and arrow bar
  (`whiteboard.js`), the Edit tools palette (vertical; `workspace-board.js`). One Tab stop, arrows move and wrap, Home
  and End jump; focus movement never presses. `ui-toolbar-button`, `ui-toggle` and `ui-toolbar-link` are
  `display: contents` (rule in `ui-sdk.css`), so our buttons lay out as before.
  - The SDK does not know an item can be absent (`hidden`, or a media query dropping it): such an item stays a tab stop
    and an arrow stop. `followVisibility(toolbar)` marks every item whose button is not rendered as disabled and
    non-focusable (`focusable-when-disabled="false"`), and restores it when it shows again. Call it on every toolbar
    whose items come and go.
  - The selection bar is built once and updated in place (count, Archive/Restore label, which of Arrange, Details…
    and Edit document show), so a focused action keeps focus across selection changes.
  - Reader: Left/Right on the reader pill used to step to the previous or next Tinka; `readerTinkaFocus` now excludes
    `ui-toolbar` and `ui-toggle-group`, as it already excluded `.tk-seg`.
- **Kind legend** (`kind-legend.js`): a `ui-toggle-group` (not `multiple`: one family can be lit at a time, as before)
  of `ui-toggle` around the existing entry buttons. Space or Enter presses, arrows move focus, Escape still lets go.

### Board canvas: keyboard and focus on cards and drawn elements (`ux/canvas`)

Files: `workspace-board.js` (the roving group: `rovingCard`, `setFocusStop`, `ensureFocusStop`, `rovingItems`,
`focusKey`, `itemKey`, `nudgeKey`, `resizeKey`, `keyMoveRunning`; the key queue's `queueableKey`), `whiteboard.js`
(one line in `markup()`: a drawn element's `tabindex` comes from the host's stop), `canvas.js` (`revealBox`, the
viewport's `+`/`−`/`0`, the board step's focus, focus back to the card after the reader), `board-step.js` (step keys),
`calm.css` (focus ring). Core helpers, standalone, from `vendor/ui-sdk/web/core.js` (a dynamic import, so the board's
start never waits for it): `nearestInDirection`, `announce`, `moveMessage`, `resizeMessage`, `keepFocus`.

**How it is built, and why not as a primitive.** The SDK's norms for a canvas (SPEC C.18a, C.19; B5 § 1.2 spatial
focus, § 4.1 `createMove` keys, § 4.2 `createResize` keys, § 6 announcements; B6.1 viewport keys) are implemented on
top of the board's own pan, drag, resize and marquee engine, not with `createRovingFocus`/`spatialMove`,
`createMove`, `createResize` or `createViewport`. Those are context helpers that need a primitive with parts around
every card (the Collections pattern above); adopting them means rewriting the most performance-sensitive code in the
app, which this experiment was told not to do. Everything added runs on key and focus events; nothing runs per card
on wheel, pointer pan, drag or marquee, and no observer was added. A later overhaul to a primitive would replace
`rovingCard`/`setFocusStop` with `createRovingFocus({ move: spatialMove({ rect }) })` (the rect function is
`rovingItems()`'s board-unit boxes), `nudgeKey` with `createMove({ step: 1, group })`, `resizeKey` with
`createResize`, and `revealBox` with `viewport.reveal`.

- **One Tab stop for the board's items.** Cards and drawn elements are one roving group. The item focused last
  (`focusStop`, its reconcile key, e.g. `placement:<id>`) has `tabindex=0`; every other card and drawn element has
  `-1`. The stop is written into the render markup (so `reconcileChildren` never fights it) and moved in place on
  `focusin` (two elements' attributes). Before anything is focused the first card holds it. A pointer press that
  focuses a card makes it the stop. If the focused item goes away in a rebuild (deleted, moved into a board, filtered
  out), focus goes to the item nearest where it was (the SDK's focus-recovery idea) instead of dropping to `<body>`.
  The dense board went from 612 Tab stops in `#world` to 1 card plus its own controls.
- **Controls inside a card (composite items).** The SDK's rule for items holding links and buttons (Timeline:
  "Tab moves from an event to the links and buttons inside it, and arrow keys pressed on them stay with them") is
  applied to the stop card only: its select circle, ⋯, Open, title, resize corner and hover-toolbar buttons follow it
  in Tab order; on every other card they carry `tabindex=-1` (added to the card's markup by `rovingCard`, removed when
  it becomes the stop). So Tab goes: card → its controls → out of the board. Arrows pressed on an inner control are
  not focus moves (they still pan, as before); the hover toolbar (`role=toolbar`) owns its own arrows.
- **Arrows move focus, not things.** Plain arrows (Shift too) on a focused card or drawn element move focus to the
  nearest item that way: `nearestInDirection` on board units from the board's data (no layout read; Grid layout uses
  screen boxes), so zoom never matters and Left is always screen-left. The view pans just enough to bring it in, in
  one step, clear of the floating footer (`revealBox`, the SDK's `focus-in` reveal, which is a `panBy` with no
  animation). It was a 240 ms glide; each glide frame restyled the board and arrows dropped frames on the dense
  board, and a glide trails behind a held arrow. See "Restyle cost" below. Home / End go to the first card / the last
  item (cards in reading order, then drawn elements; drawn elements come first in the DOM only for stacking). A held
  arrow keeps moving. Connector arrows are items too, so moving between two joined cards can land on the arrow
  between them first (what `spatialMove` does with every item in the group).
- **Focus is not selection.** Space toggles the focused item's selection and focus stays; Enter opens the focused
  card (not "the one selected", which still works with focus off the cards); a drawn element's Enter / F2 stay
  Whiteboard's (inspect, edit text). ⌘/Ctrl-click toggles. **⇧-click stays a toggle on the canvas** (lead's decision,
  2026-11-18): the SDK's ⇧-range needs an order, and a 2-D board has none to follow (Home's grid does, and gets ranges).
  Focus ring: an ink ring outside the blue selection line, so a focused selected card shows both.
- **Option/Alt + arrow moves the focused item**, 1 unit, 10 with Shift (`createMove`'s keys and default steps). A
  focused item that is selected carries the whole selection (and a mixed group's drawn elements); one that isn't
  moves alone; with no item focused, the selection moves (the old arrow behaviour, now on Option). One undo step per
  press. Plain arrows never move anything. Each move is announced with `moveMessage` ("A2 moved to 299, 0." /
  "2 items moved to 301, 270.").
- **Resize corner:** a button named "Resize bottom right of <title>". Arrows move that corner, 1 unit, 10 with Shift
  (`createResize`'s keys), within the card's minimum size; announced with `resizeMessage` ("A1 resized to 241 by
  170."). Escape still cancels a pointer drag or marquee and puts things back; there is no keyboard pick-up to cancel.
- **Writes queue instead of racing.** A keyboard move or resize holds the board busy until its write and refresh land
  (`keyMoveRunning` sets `movePending`), and `installKeyQueue` now queues Option-arrows and arrows on a resize corner
  meanwhile and replays them in order. Before this, a second quick press read the old geometry and overwrote the
  first. Plain arrows (focus, panning) are never queued, so they act at once while a write is in flight; nor are
  Space and Enter on a button or link (queuing them cancelled the button's native press: a select circle pressed
  during a save did nothing).
- **Zoom keys:** `+`/`=`, `−` and `0` (100%, position kept about the centre) with the canvas or a card or drawn
  element focused; announced in the board's existing `#view-announce` region ("Zoom 115%"). ⇧0, ⇧1, ⇧2, F and M are
  unchanged. Arrows / Page keys / Space still pan when the canvas itself has focus.
- **Board step moved to `[` / `]` on a Mac.** ⌥←/→ used to select the previous / next Tinka on a board; it is the
  SDK's move chord, so on the board it now moves the focused item, and stepping is `[` / `]` (the opened Tinka's own
  fallback step keys, so they still mean the same thing on a board and inside a Tinka). Ctrl+←/→ still steps on
  Windows and Linux, where Alt+arrow moves (or stays browser Back when there is nothing to move). Inside an opened
  Tinka ⌥←/→ is unchanged. A step with focus on the board takes focus to the stepped card.
- **Focus comes back.** Opening a card (Enter, or a click) and closing the reader returns focus to the card last
  viewed when the reader was opened from the board's items (A5's return-to-trigger rule), instead of to the canvas.
- Help text, the canvas's `aria-label` and the Keyboard shortcuts sheet describe all of this.

### Menus and popovers (`ux/menus`)

Shared: `popups.js`, `popups.css` (see § Popups). Components: Menu, Popover.

- **Card ⋯ and right-click** (`workspace-board.js` `tileMenu`, `runTileMenu`): one `ui-menu#workspace-tile-menu` at the
  end of `<body>`. ⋯ opens it under the button (right edges aligned), right-click at the pointer (selecting the card
  first, as before), Shift+F10 / context-menu key on a focused card under its ⋯; ↓/↑ on a focused ⋯ open at the first /
  last item. A second right-click re-anchors (on another card it becomes that card's menu). Items keep
  `data-tile-menu`; Handoff is a link item. Wheel, a scroll that moves the card, or a resize closes it, as before (the
  SDK says nothing about scrolling). The legacy canvas's `.legacy-tile-menu` (`canvas.js`) is not converted.
- **Add and the board context menu** (`addMenuItems`, `addMenuElement`, `addMenu`, `runAdd`): `#workspace-add-menu`
  with the Add button as its trigger; `#board-context-menu`, the same items, opened by a right-click on empty canvas
  (an object lands at the pointer), by Shift+F10 on the focused canvas (centre), and beside the edit tools' More. Two
  elements so a right-click never marks Add expanded. Items keep `data-add`.
- **Arrange** (`arrangeMenu`): `#arrange-menu`, opened from the selection bar or the drawn-object bar. A menu is a
  vertical list, so the old 6-column icon grid became Align and Distribute groups whose items carry their names
  (typeahead: "d" finds Distribute). Disabled choices stay focusable.
- **Zoom** (`board.html` `#zoom-popover`, `canvas.js`): a Popover (it holds a slider and the Pattern segmented
  control), outside the pill. Focus goes to the first control, ↑/↓ still step through its buttons, Tab walks through and
  out (closing it), Escape returns to %, an outside press closes it and reaches its target (Popover is non-modal).
  The reader's % menu (`#reader-zoom-menu`) is not converted.
- **Comments** (`comment-pins.js` `mountMenus`, `renderMenu`, `openCluster`): `#comment-layer-menu` (trigger: the
  Comments button) with checkbox items Show comments (⇧C) and Show resolved, which stay open as they toggle, then the
  threads waiting on you; `#comment-cluster-menu` beside a cluster pin (flips when there is no room). "Nothing right
  now" is a disabled item.
- **Reader More…** (`canvas.js` `setReaderMoreOpen`, `readerAct`): `#reader-more` inside the reader dialog, above the
  button, flipping down when there is no room. Inspector buttons and menu items run through one `readerAct()`.
- **Reader path** (`reader-path.js`, `board.html` `#reader-path-menu`): a **Menu**, not a Popover or Hover Card: each row
  is a place to go (a list of actions, like a Finder path menu); a Hover Card needs a link trigger and never opens on
  touch; a Popover is for fields. Its two triggers are the title and the count. The SDK has no hover-open menu, so the
  old hover delay is gone: it opens on a press. "… n more" unfolds in place (`close-on-select="false"`).
- **Whiteboard More** (`whiteboard.js` `mountMenu`, `openMenu`, `runMenu`): `#whiteboard-menu` under the bar's More,
  anchored to whichever More button the bar currently has. Custom colour is an item that opens the system colour
  picker (an off-screen `input[type=color]` beside the bar); the rest keep `data-whiteboard-action` for tests but run
  through the menu's `action` event.
- **Home Appearance** (`appearance.js`): a menu of two radio groups, Mode and Background; radio items stay open; the
  Background items are disabled (focusable, inert, titled) while the page is dark. The Inspectors keep their
  segmented rows.

### Comment thread card and the @ picker (`ux/comments`)

Files: `comment-thread.js`, `comment-thread.css`, `comment-refs.js` (`attachPicker`). Components: Popover, Trigger Menu.

- **Card: a non-modal `ui-popover`** appended to `<body>` (never inside a board card), its `ui-popover-content.ct-card`
  opened from code with `api.open({anchor})`. The anchor is an object whose `getBoundingClientRect()` returns the pin's box;
  it follows the pin while the board is still panning to it, then freezes, so the card does not trail later pans (as before).
  Placement is the SDK's: `side=right align=start side-offset=12 align-offset=-40 collision-padding=8`, flipping to left,
  below, above; it only shifts along the anchor's edge, so it never covers the pin. At <=760 px `presentation="sheet"` (the SDK's
  bottom sheet; it also dims the page) with `.ct-sheet` styling. `ui-popover-content` has global padding/overflow in
  `popups.css`; `.ct-card` resets both. Not modal: Tab can leave (closes it), outside press closes, the draft is kept.
- **Escape peels one layer.** A `openchange` listener on the popover cancels `escape-key` while the @ list is open (the Trigger
  Menu takes that Escape; the card compares `detail.event` with the keydown it saw), then while editing or confirming a delete.
- **Focus** goes into the composer on open (retried each frame until the popover is shown) and on close returns to the element
  focused before it opened, else the thread's pin, only when focus was lost (a press on another control keeps it) and no other
  card has opened meanwhile. Done in code: the pin is not a `ui-popover-trigger`, and `final-focus` is `none`.
- **@ picker: `ui-trigger-menu`** wrapped around each composer (also the edit box) by `attachPicker`, bound through an editor
  adapter (`menu.editor`) for the contenteditable: the text is the composer's text with each chip as U+FFFC; `textBefore`,
  `selection`, `rectAt`, `replace` and `subscribe` are implemented there. The menu's content is created before the menu is
  connected (otherwise it makes its own). Items are composed `ui-trigger-menu-item`s in groups Items / Drawn / Boards, filtered by
  the SDK; empty groups are hidden in CSS. `itemselect` is cancelled and the existing chip insertion runs. Focus stays in the
  composer; the composer carries `aria-controls`, `aria-activedescendant`. The menu is nested in the card's popover, so a press
  in the list is not an outside press.
- Key handling: the card still stops keydown (except Escape) from reaching the board; board handlers also step aside through
  `role=dialog` and `inPopup`. ⌘↩ still posts/saves.

### Tooltips (`ux/tooltips`)

Files: `tips.js` (new: the shared tooltip and its helpers), the tooltip rules at the end of `ui-sdk.css`; hints moved
from `title` to `data-tip` in `board.html`, `home.html`, `canvas.js`, `workspace-board.js`, `whiteboard.js`,
`comment-pins.js`, `kind-legend.js`, `navigator.js` (its header toggle only), `workspace-home.js`, `home.js`,
`appearance.js`, `relative-dates.js`, `ui-segmented.js`. Shared: `widgetOwnsKey()` (`ui-sdk.js`) and `inPopup()`
(`popups.js`) give Escape to an open tooltip; `ui-sdk.css` and `calm.css` let the segmented rules reach an item inside
its trigger. Component: Tooltip. Test: `tests/tooltips-browser.mjs`.

- **One shared tooltip per page** (tooltip.md § Shared): `<ui-tooltip id="tk-tip">` at the end of `<body>`, made on
  first use, and a second one, `reader-dialog-tip`, inside the reader (a modal `<dialog>` makes the rest of the page
  inert, so a tooltip outside it could not be pointed into). A control carries its hint as `data-tip="…"` and sits in a
  `<ui-tooltip-trigger for="tk-tip">` whose `payload` is the control itself; on `payloadchange` the content reads
  `data-tip`. So every norm is the SDK's, and the page holds one tooltip, not one per control.
- **Markup.** Write `data-tip` (no `title`) on the control and call `tips(container)` after rendering it: it wraps each
  `[data-tip]` in its trigger and sets the payload (idempotent, cheap when nothing changed). A render that reconciles
  (Home's grid and selection bar, `timeHTML(…, {tip: true})`, `segmentedHTML` items with `tip`) writes the wrapper in its
  markup with `tipTrigger(html)`, so reconciling keeps it; `tips()` then only sets payloads. Change a hint with
  `setTip(el, text)` (an open tooltip follows). `data-tip=""` keeps a trigger silent (the Inspector's Background row,
  which explains itself only in dark mode); `data-tip-truncated` shows the hint only while the element's text is cut
  off (board title, Home's board titles; tooltip.md § Truncated Text).
- **Nesting.** The tooltip trigger is the outermost wrapper: `<ui-tooltip-trigger><ui-toolbar-button><ui-menu-trigger>
  <button>`. The tooltip trigger finds the button inside the others; a menu or toolbar part outside the tooltip
  trigger would bind the trigger element instead (tested). `tips()` wraps the outermost of a control's own
  display:contents wrappers. **Anything inserted next to a hinted control goes next to `tipOuter(control)`**, or it lands
  inside the trigger, which binds the first button or link it holds (the board's parent crumb, the Navigator toggle
  beside the brand, the edit-tools toggle beside the map toggle, Undo/Redo beside the Inspector toggle).
- **Shortcuts** come from the control's `aria-keyshortcuts` (only this platform's ones: "Meta+K Control+K" shows ⌘K on
  a Mac, Ctrl+K elsewhere) and show as `<ui-tooltip-shortcut>` parts, hidden from screen readers (who hear
  `aria-keyshortcuts`), printed as the app prints keycaps (`capLabel`: "⇧1", "⌘K", "Esc"), several joined with "or".
  A labelled `tk-btn` with `aria-keyshortcuts` gets a visible keycap (`keycaps.js`), so where the tooltip names a
  shortcut the button doesn't print, the keys go in `data-tip-keys` (the map head's Fit buttons, Comments, the reader's
  Down).
- **Names.** Every trigger of a shared tooltip needs a name of its own, so the tooltip describes it and never labels
  it; `tip()` adds `aria-label` from the hint when a control has no name. Where the hint only repeats the name
  ("Zoom in"), its words are `aria-hidden` inside the content, so screen readers don't hear it twice. The Edit tools'
  names lost their " · T" suffix: the key is now `aria-keyshortcuts` and shows in the tooltip.
- **Escape.** With a tooltip showing, Escape belongs to it (it closes only the tooltip, tooltip.md § Keyboard):
  `widgetOwnsKey()` and `inPopup()` return true, so the board's Escape ladders (selection, Inspector, reader) take the
  next press. The kind legend's own Escape waits the same way. A tooltip that opened by hover over the reader also
  takes the first Escape.
- **Look.** `.tk-tip`: an ink face like the toast (`data-height="float"` with the rim set to the face, so only the
  soft cast shows), 12 px text, `--shape-cell` corners, no arrow, a 120 ms fade that `data-instant` skips. Placement is
  the SDK's (top, flipping and shifting, 8 px from the window's edges).
- **Boundary: chrome on the SDK, the canvas on native titles.** Everything outside `#world` that had a hint is on the
  SDK tooltip: the canvas header (brand, UI SDK tag, parent crumb, board title, Find, Undo/Redo, Inspector, Add,
  Navigator toggle), both zoom pills (−, %, +, Back, map, edit tools, Fit), the selection bar, the whiteboard object and
  arrow bars, the Edit tools palette, the board map head, the comment bar, the kind legend, the board and item
  Inspectors (close keys, Undo/Redo, appearance items, paper swatches, dates, the dark-mode Background row), the
  reader's header and footer, and Home's masthead, selection bar, board titles and dates (the old `tk-date-tip` is
  gone). **Everything inside `#world` keeps its native `title`**: card controls (select circle, ⋯, title, resize corner,
  the hover toolbar's Edit, Comments, Vote, Favorite), badges, board-tile dates, drawn-element ports and arrow handles,
  comment pins, the legacy canvas's cards. Measured headless on `showcase-dense` (84 items, 560 card controls): wrapping
  the card controls in triggers cost about 12% on a cold board render (46 → 52 ms median) and about 20% on each
  wheel-pan event's forced style recalculation (13.5 → 16.5 ms), the hottest path. With the chrome converted and the
  cards left alone, runs stayed within run-to-run noise (`team/ux/tooltips/evidence`; the machine was loaded, so read
  these as rough). Also left native, each a whole surface: popup contents (the zoom popover's slider; the reader's %
  menu, not on the SDK: Window sizes, the Light note, Type size; the Home Appearance menu's disabled Background group in
  dark mode), the Navigator panel (its rows sit in the SDK Tree's `as-child` labels, which a trigger can't wrap), and
  the reader stage's resize hint. `<iframe title>` is an accessible name, not a hint, and stays everywhere.
- **SDK notes (0.1.0-beta.10).** (1) The trigger manages `aria-describedby` on its control (an existing one is
  replaced) and writes `type="button"` even on a link, a heading or a `<time>`. (2) After a tap on one trigger of a
  shared tooltip, the next mouse hover on another is ignored until the pointer leaves a trigger (the press flag is per
  tooltip, and a tap's `pointerleave` comes before its click). (3) A hand-over within a shared tooltip is a payload
  change, not a new open, so it gets no `data-instant` (it doesn't re-animate either).

### Side-by-side page (`compare.html`)

`public/compare.html` is generated by `team/ux/guide/compare.py` (outside the repo) from the guide's steps. It shows the
app before the experiment (the "before" instance, `?before=URL`, default: this host's next port) and this instance as
two live halves at a 1024 px layout width, scaled to fit. The page runs on `localhost` and the halves on `127.0.0.1`, so
both halves stand in the same relation to it. Each app page loads `frame-focus.js`, which does nothing outside a frame
and inside one makes the page take and keep the keys as a window does: a press makes its frame active; while the other
frame is active, a script `focus()` only sets what gets focus when this frame is active again (a board loading in one
half would otherwise take the keys from the other); the element that had focus comes back when the frame becomes
active again; and Tab wraps from the last control to the first (Shift+Tab the other way). The before half is served
from branch `ux/base-framed`: the experiment's base plus `frame-focus.js`.
