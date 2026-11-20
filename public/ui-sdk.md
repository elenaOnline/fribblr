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
  (4) A Select with several external triggers (`for=`) marks them all expanded, anchors its list to the first and
  returns focus there, so a list shared by rebuilt per-card triggers is a Menu (radio items) opened with `openMenu`.
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
- **No per-frame view animation on input paths.** Keyboard reveal moves in one step (§ Board canvas); a glide that calls
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

- **Toolbars on Home:** the Favorites/Archive row (`.workspace-home-toolbar`) and the floating selection bar are
  `ui-toolbar`s of `ui-toolbar-button`s: one Tab stop each, arrows and Home/End along the actions. The bar is built once
  on the first selection and updated in place (count, Archive/Restore label), so a focused action keeps focus as the
  selection changes; `followVisibility` keeps it out of the Tab order while hidden. Its Clear button carries the SDK
  tooltip (`data-tip`, `aria-keyshortcuts="Escape"`). The sort control and Appearance menu belong to the toolbars and
  menus streams.

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

### Board canvas: keyboard and focus on every board item (`r2/canvas`)

Files: `board-focus.js` (the roving group, as one class `BoardFocus`, plus pure helpers that `tests/board-focus.test.mjs`
covers), `workspace-board.js` (the board's capture-phase key handler and its Escape ladder, the key queue's
`queueableKey`, `translateOccurrences`, `keyMoveRunning`, the focus bookkeeping on `focusin` and `pointerdown`, the card
markup passing through `boardFocus.cardMarkup`), `whiteboard.js` (drawn elements' markup through
`boardFocus.decorationMarkup`; the keyboard resize corner; Enter on a container; announcements for arrow ends and
sticker turns), `canvas.js` (`revealBox`, the viewport's `+`/`−`/`0`, the board step's focus, focus back to the card
after the reader), `board-step.js` (step keys), `calm.css`
(focus rings). Core helpers, standalone, from `vendor/ui-sdk/web/core.js` (a dynamic import, so the board's start never
waits for it): `nearestInDirection`, `announce`, `keepFocus`, `moveMessage`, `resizeMessage`, `reorderMessage`.

**How it is built, and why not as a primitive.** The SDK's canvas norms (SPEC C.18a, C.19; B5 § 1.2 spatial focus, § 3.2
`createReorder` keys, § 4.1 `createMove` keys, § 4.2 `createResize` keys, § 6 announcements; B6.1 viewport keys) are
implemented on top of the board's own pan, drag, resize and marquee engine, not with `createRovingFocus`/`spatialMove`,
`createMove`, `createResize`, `createReorder` or `createViewport`. Those are context helpers that need a primitive with a
part around every card (the Collections pattern above); that would put SDK elements on the paths that must stay cheap
(the tooltips stream measured ~20% more wheel-pan style work from per-card wrappers). Everything here runs on key, focus
and press events; nothing runs per card on wheel, pointer pan, drag or marquee, and no observer was added. A later
overhaul to a primitive would replace `BoardFocus` with `createRovingFocus({ move: spatialMove({ rect }) })` (the rect is
`items()`'s board-unit boxes), `moveKey` with `createMove({ step: 1, group })`, `resizeKey` with `createResize`,
`reorder` with `createReorder`, and `revealBox` with `viewport.reveal`.

- **One Tab stop for the board's items.** Cards and every drawn element (text, shapes, regions, arrows, stickers,
  containers) are one roving group. The item focused last (`boardFocus.stop`, its key, e.g. `placement:<id>`,
  `decoration:<id>`) has `tabindex=0`; every other item has `-1`. The stop is written into the render markup (so
  `reconcileChildren` never fights it) and moved in place on `focusin` (two elements' attributes). Before anything is
  focused, the first card on the board itself (not inside a container) holds it, else the first drawn element there. If
  the focused item goes away in a rebuild, focus goes to the item nearest where it was (the SDK's focus-recovery idea).
- **Controls inside an item (composite items).** The SDK's rule for items holding links and buttons (Timeline: "Tab moves
  from an event to the links and buttons inside it, and arrow keys pressed on them stay with them") applies to the stop
  only: its select circle, ⋯, title, resize corner, hover-toolbar buttons and version ticker follow it in Tab order; inside
  every other item they carry `tabindex=-1`. The same goes for 1.3's controls inside drawn elements: a Text block's task
  boxes and links, a selected sticker's rotate and resize handles, and a Text block's label, which scrolls when its text
  overflows (Chrome makes such a scroller a Tab stop of its own). The preview's big "Open" never takes a Tab stop (it
  duplicates the title and the toolbar's Open).
- **Arrows move focus, not things.** Plain arrows (Shift too) on a focused item move focus to the nearest item that way:
  `nearestInDirection` on board units from the board's data (no layout read; Grid layout uses screen boxes), so zoom never
  matters and Left is always screen-left. The view pans just enough to bring it in, in one step, clear of the floating
  footer (`revealBox`). Home / End go to the first card / the last item. A held arrow keeps moving. Arrows pressed on a
  control inside an item stay with it (they pan, or scroll an overflowing Text block).
- **Containers are composite items.** On the board a container is one item: the arrows outside pass over its members
  (they move among items whose container is the same, `scope()`). **Enter** on a container goes in, to the member focused
  last there (the SDK's `remember: true`), else its first, and says "Stack: 3 items. One. Escape returns to the
  container." Inside, the arrows move among its members and stop at its edges; Home / End reach its first / last member
  in the container's own order. **Escape** comes back out to the container, as the last step of the board's Escape ladder
  (after popups, gestures, edits, a pending cut and the selection). An empty container has nothing to enter, so its
  Enter keeps Whiteboard's meaning (its options). F2 still edits the container's title.
- **Focus is not selection.** Space toggles the focused item's selection, as ⌘/Ctrl-click does (`toggleOccurrence`), and
  focus stays; a grouped item brings its whole group, as a click does ("Group of 2 selected. 2 selected."). Enter opens the
  focused card (not "the one selected", which still works with focus off the items); a drawn element's Enter / F2 stay
  Whiteboard's (options, edit text). ⇧-click stays a toggle on the canvas (round 1's decision: a 2-D board has no order for
  a range). Focus ring: an ink ring outside the blue selection line, following the card's squircle and standing clear of
  a version stack's sheets (`--under-d`), so a focused selected item shows both. Drawn elements get the same ring, square.
- **Option/Alt + arrow moves the focused item**, 1 unit, 10 with Shift (`createMove`'s keys and steps). A focused item
  that is selected carries the selection (and a mixed group's drawn elements); a grouped one that is not selected carries
  its group, as dragging it does; one that is neither moves alone; with no item focused, the selection moves. A container
  moves with its contents. One write and one undo step per press, announced with `moveMessage` ("A2 moved to 299, 0." /
  "2 items moved to 301, 270.").
- **Option/Alt + arrow on a container member reorders it** (`createReorder`'s keys on the move chord): one place along
  the container's layout (a stack along ↑/↓, a row along ←/→, a grid ←/→ one place and ↑/↓ a row), with Shift to the
  first or last place. One `moveContainerMember` write, one undo step, focus stays on the member, announced with
  `reorderMessage` ("Dropped Three at position 2 of 3."). An arrow across the layout moves nothing and says where it is.
  The SDK's reorder picks up with Space; on the board Space already selects, so the board's move chord does it in one
  press instead.
- **Resize corners.** A card's corner is a button named "Resize bottom right of <title>". A selected shape, Text block or
  sticker now has one too: its bottom-right handle is a focusable `role=button` named the same way (the other seven stay
  pointer-only). Arrows move that corner, 1 unit, 10 with Shift (`createResize`'s keys), within the minimum size; a sticker
  keeps its proportions, as its corners do under the pointer; an auto-height Text block becomes fixed, as a drag makes it.
  Announced with `resizeMessage`. Arrow ends, an arrow's bend and a sticker's rotation already had keys; they are now
  announced too ("Arrow end moved to 420, 310.", "Sticker rotated to 15°.").
- **Writes queue instead of racing.** A keyboard move, reorder or resize holds the board busy until its write and refresh
  land (`keyMoveRunning`), and the key queue holds Option-arrows and arrows on a resize corner meanwhile and replays them
  in order. Plain arrows, and Space / Enter on a focused item or on a button, are never queued: they act at once (a replay
  would land on whatever has focus by then, or swallow a button's native press).
- **Zoom keys:** `+`/`=`, `−` and `0` (100%, position kept about the centre) with the canvas or an item focused; announced
  in `#view-announce` ("Zoom 115%"). ⇧0, ⇧1, ⇧2, F and M are unchanged. Arrows / Page keys / Space still pan when the canvas
  itself has focus.
- **Board step is `[` / `]` on a Mac.** ⌥←/→ is the SDK's move chord, so on the board it moves the focused item, and
  stepping is `[` / `]` (the opened Tinka's own fallback keys). Ctrl+←/→ still steps on Windows and Linux. Inside an opened
  Tinka ⌥←/→ is unchanged. A step with focus on the board takes focus to the stepped card.
- **Focus follows a press.** A press on a drawn element focuses it (a card takes focus natively; Whiteboard's pointerdown
  prevents that for drawn elements), so Option-arrow and Space act on what was pressed, never on an item focused earlier;
  a press on empty canvas takes focus off the items. Pointer focus draws no ring (`pointer-focus.js`).
- **Focus comes back.** Closing the reader returns focus to the card last viewed when it was opened from the board's
  items. Escape in the selection bar sends focus to the board's roving item (or the first card, or the canvas).
- **The board's key handlers step aside** for SDK widgets: `inPopup()` first (an open menu or popover owns every key,
  Escape included), `widgetOwnsKey()` before the item keys (a focused toolbar, radio group, slider or listbox owns its
  arrows; a menu owns its letters as typeahead). The same two checks guard the board commands (`boardCommandBlocked`),
  ⌘D, ⌘Z, the step keys, the mixed-group and pan-tool Escapes, cut's Escape and the key queue. A modal is
  `dialog[open]` or an SDK modal (`MODAL_OPEN` in `workspace-board.js`).
- **Shortcut audit (1.3's keys against these).** ⌘G groups / ungroups only when there is something to group (else the
  browser's Find Next stays); with keys, Space selects each item and ⌘G groups them. A, T, S, D, N, E, M, V, H, C, F and Z are
  plain letters: they fire only on the board, never in a field (`boardCommandBlocked`), and inside a menu they are its
  typeahead. ⌥-drag (copy) is a pointer chord and does not meet ⌥+arrow. Plain arrows on a card no longer nudge the
  selection (1.3 did); that moved to ⌥+arrow. The canvas's `0` is new; ⇧0 is unchanged.
- **The marquee is left as it is** (decided again for 1.3): the SDK's `createLasso` is a context helper that needs a part
  around every item and commits the selection only on release, where ours selects live as the box grows and supports
  holding F or Z through it; its documented keyboard behaviour (Escape cancels and keeps the old selection; Shift adds)
  is already ours. The one thing it adds, announcing the count once the selection is made, is added: the result is said
  on release.
- **The board map** is not a canvas item and keeps no SDK minimap (there is none; `createViewport` is the board's own
  viewport model). The reader stream made its head a toolbar and its stage follow the SDK viewport keys (`0`, zoom
  announcements); the board's key handler steps aside for the whole map (`.board-map`).
- Help text, the canvas's `aria-label` and the Keyboard shortcuts sheet describe all of this.

### Menus and popovers (`ux/menus`, round 2 on Tinka 1.3: `r2/menus`)

Shared: `popups.js`, `popups.css` (see § Popups; `popups.css` is linked last on `board.html` and `home.html`). Components:
Menu, Popover. Every menu below: typeahead, wrap, Home/End, Escape one layer, focus into it on open and back on close,
an outside press closes only the menu, placement flips and shifts at the window edge (`collision-padding="8"`), Tab
closes it and moves on from the opener.

- **Card ⋯ and right-click** (`workspace-board.js` `tileMenuElement`, `tileMenu`, `runTileMenu`, `menuKey`): one
  `ui-menu#workspace-tile-menu` at the end of `<body>`. ⋯ opens it under the button (right edges aligned), right-click at
  the pointer (selecting the card first), Shift+F10 / the context-menu key on a focused card under its ⋯; ↓/↑ on a
  focused ⋯ open it at the first / last item. A second right-click re-anchors (on another card it becomes that card's
  menu). Focus returns to the ⋯ when it came from the ⋯, else to the card; Details… from the card's menu returns to the
  card when the Inspector closes. Items keep `data-tile-menu`; Handoff is a link item. Wheel, a scroll that moves the
  card, or a resize closes it.
- **Card menu on legacy boards** (`canvas.js` `legacyMenuElement`, `openLegacyMenu`, `runLegacyMenu`):
  `#legacy-tile-menu`, the same pattern (content keeps `.workspace-tile-menu.legacy-tile-menu`). Items run through the
  menu's `action` event, not the board's `data-open` / `data-tile-notes` / `data-remove-experiment` click handlers.
  `tile-ui.js` lost the hand-rolled `bindTileMenu`.
- **Add and the board context menu** (`addMenuItems`, `addMenuElement`, `addMenu`, `runAdd`): upstream 1.3's option list
  in two menus with the same items: `#workspace-add-menu` with Add as its trigger (`ui-menu-trigger for=`), and
  `#board-context-menu`, opened by a right-click on empty canvas (the object lands at the pointer) or Shift+F10 on the
  focused canvas (its centre). Two elements so a right-click never marks Add expanded. T, S and D print as keycaps; inside
  the menu letters are typeahead. Items keep `data-add`, so tests scope them: `#workspace-add-menu [data-add=…]`.
  `whiteboard.css` hides the drawn-object bar only while an Add menu is open (`.workspace-add-menu[data-open]`): the
  content is now always in the page.
- **Arrange** (`arrangeMenuElement`, `arrangeMenu`, `positionArrangeMenu`): `#arrange-menu`, opened from the selection
  bar's Arrange or the drawn-object bar's (↓ opens it from either toolbar). A vertical menu with Align and Distribute
  groups whose items carry their names (typeahead: "d" finds Distribute); Distribute is disabled below three objects,
  still focusable. It opens on the side of its bar away from the selection (upstream 1.3's intent: the objects stay in
  view) and `positionArrangeMenu` re-reads that side when the view moves. The trigger gets `aria-haspopup="menu"` and
  `aria-expanded` from `arrangeMenu`, whoever builds the button.
- **Zoom popovers** (`board.html` `#zoom-popover`, `#reader-zoom-popover`; `canvas.js` `setZoomMenuOpen`,
  `setReaderMenuOpen`): Popovers (sliders, the Pattern / Window / Light segmented controls, the version list), outside
  their pill toolbars; the reader's inside the modal reader dialog. Trigger: `ui-popover-trigger for=` around %. ↓ on %
  opens them (`openOnArrowDown`, a Popover trigger has no ↓). Focus goes to the first control, ↑/↓ still step through the
  buttons, Tab walks through and out to the next pill control, Escape and a choice return to %, an outside press closes
  them and reaches its target. A click into the experiment frame closes the reader's; switching windows leaves it open.
  The pill's 44px rows and slider theme reach them by naming `.board-zoom-popover` / `.reader-zoom-popover` /
  `.zoom-menu` in the theme's own selectors (`calm.css`, `canvas.css`, `ui-sdk.css`), at the same specificity: no copied
  rules. Placement matches the old `right: -40px` (`align="end" align-offset="-40"`).
- **Home Appearance** (`appearance.js`): a menu of two radio groups, Mode and Background; radio items stay open; the
  Background items are disabled (focusable, inert, titled) while the page is dark. Light is upstream 1.3's default; an
  overview capture's forced appearance (`?overview&appearance=…`) is not saved and the menu shows the stored choice.
  The Inspectors keep their segmented rows (controls stream).
- **Comments** (`comment-pins.js` `mountMenus`, `renderMenu`, `openCluster`): `#comment-layer-menu` (trigger: the Comments
  button; ↓ opens it from the pill) with checkbox items Show comments (⇧C) and Show resolved, which stay open as they
  toggle, then the threads waiting on you; `#comment-cluster-menu` beside a cluster pin, clear of the bottom bar (its
  `collision-padding` is the bar's height). "Nothing right now" is a disabled item.
- **Reader path** (`reader-path.js`, `board.html` `#reader-path-menu`): a **Menu** opened on a press (title or count), not on
  hover. Each row is a place to go; "… n more" unfolds in place (`close-on-select="false"`).
- **Drawn-object More** (`whiteboard.js` `mountPopups`, `openMenu`, `runMore`): `#whiteboard-more-menu`, anchored to the bar's
  current More (the bar re-renders as the selection saves), on the bar's side away from the object. Its actions are
  upstream's (Fit height to text, Select section contents, Edit container title, Remove from container). Items carry
  `data-whiteboard-more`, not `data-whiteboard-action`, so the bar's click handler never runs them twice.
- **Container More options** (`whiteboard.js` `configureContainer`): a **Popover** `#whiteboard-container-popover` (gap and
  padding scrubbers, columns), centred on the bar away from the container, as upstream placed it. Closing it by any route
  completes a valid in-progress edit (`container-layout.js`). Content keeps `.whiteboard-menu.whiteboard-container-layout`
  for the theme. Tab out continues from More options (`content.tabTrigger`). The bar's other panels (colour, text size and
  ink, drawing options) stay in `whiteboard.js`'s own panel element: those belong to the colour and text-format controls.
- **Version stacks** (`workspace-board.js` `versionMenuElement`, `versionMenu`; `canvas.js` `#reader-version-menu`): the
  version name on a stack's tile and in the reader's strip is a menu button listing every version as radio items (name
  and modified time) that close the menu on choice; ‹ › still step. **Menu, not Select**: a Select's external triggers
  (`for=`) all expand together, anchor to the first trigger and return focus there (0.1.0-beta.10), so one Select can't
  serve the per-card triggers the board rebuilds, and a Select per card would put its popup inside the card. A menu radio
  group is the SDK's other single-choice list. The name keeps a `role="status"` span, so stepping is still announced.
- **Copy preview** (`copy-preview.js`): the ghosts drawn while ⌥-dragging copies. No SDK component applies. The nearest,
  Core's `bindDragPreview`, clones one element into the top layer at screen scale, which would re-mount every card's live
  frame (a second browsing context, which `copy-preview.js` exists to avoid) and lose the board's zoom and the objects'
  relative places. The ghosts already do what the SDK asks of a drag copy: an `aria-hidden` layer, `inert`, ids and
  board keys stripped, Escape cancels the drag.
- **Keys.** Board handlers that run in the capture phase step aside for an open popup (`inPopup`): the board's key handler
  (`menuKey` also opens the card and board menus from Shift+F10 and ↓/↑ on a ⋯ or a version name, and lets a menu button in
  a toolbar take ↓), board commands (`boardCommandBlocked`, so `[`/`]`, ⌘D, letters wait), the whiteboard's keys, the
  panning tool's Escape, the comment layer's Escape, the reader's Escape ladder, ⌘I and reader commands.

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

### Opened item: the reader as a modal Dialog (`r2/reader`)

Files: `reader-dialog.js` (new: `trapTab`, `tabStops`, `rememberOpener`, `openerToReturnTo`), `canvas.js` (`openReader`,
`closeReader`, `focusBoardItem`, `handleEscape` and the document Escape handler, `updateReaderNavigation`),
`board.html` (`#reader-stepper`), `reader.css`. Components: Dialog (behaviour), Pagination.

- **Still the browser's `<dialog>`, behaving as the SDK's modal Dialog.** `showModal()` already gives what `ui-dialog`
  `modal="true"` gives: the top layer, the rest of the page inert and hidden from assistive technology, `aria-modal`.
  Swapping the element for `ui-dialog-content` would change every `dialog[open]` check across the app and about 90
  test selectors in 24 files that the other streams also edit, and upstream 1.4 edits these same lines
  (`openReader`/`closeReader`/`loadRevision`) for its resource viewer. What the browser leaves out is added:
  - **Focus on open**: Tinka's canvas (`#reader-stage`), so its keys work at once: the SDK's `initial-focus` set to the
    canvas, as before.
  - **Tab wraps** (dialog.md § Modal: trapped). From the last control Tab goes to the first, Shift+Tab from the first to
    the last; the browser's dialog let Tab leave for the browser's toolbar. A nested modal dialog or a menu inside keeps
    its own Tab (`OWN_TAB`).
  - **Escape, one layer at a time.** An open SDK popup inside the reader (menu, popover, tooltip, nested dialog, an
    Inspector with focus inside it) takes its own Escape first (`inPopup` in the document Escape handler); then the
    reader's ladder peels feedback → path → % menu → Inspector → Navigator → notes, wherever focus is in the reader,
    and only then closes the reader. Escape during IME composition does nothing (as before).
  - **Focus goes back where it came from** (popups.md § Focus). Opened from a card on the board, focus returns to the
    card last viewed (after any `[` / `]` stepping) without moving the board: the canvas's roving card
    (`graph.focusPlacement`, when the canvas stream's roving group is there) or the card's Open control. Opened from
    anything else (the Navigator, a link), focus returns to that control while it is still on the page, else to the
    canvas.
  - Unchanged: `[` `]`, ⌥←/→ (Ctrl+←/→ elsewhere) and plain ←/→ on Tinka's own chrome step; ⌥↑ / Escape go up; F,
    ⇧1, ⇧0, + / − zoom; ⌘I toggles the Inspector; keys forwarded from same-origin content.
- **Stepper: `ui-pagination`** (`#reader-stepper`, labelled "Step through <board>"; role `navigation`, a list inside).
  `‹` and `›` are its Previous and Next parts; the `n / N` count between them stays our button (it opens the path's
  neighbours). We set `pageCount` and `page` from the stepping sequence (property writes, no event) and cancel
  `pagechange`: our own click handlers step. What changes: at either end the step keeps focus and says it is disabled
  (`aria-disabled`, `data-disabled`) instead of turning natively disabled and dropping focus to the canvas
  (pagination.md: "Pressing Next onto the last page keeps focus on Next"). The dimmed look keys on `aria-disabled` too.
- **Notes column: left as it is, with the reason.** `#notes-panel` is a column the reader lays out beside the content
  (the content narrows), not a panel over it, so it stays an `aside` named by its heading. It already behaves as the
  SDK's non-modal Dialog would: Notes opens it with focus in the field, Escape inside closes it and focus returns to
  Notes, Tab moves on and it stays open, the × closes it. Converting it would change nothing she can feel.
- **Footer:** the zoom pill and its % menu are the controls and menus streams'. Its place in the order is after the
  content, before the notes column.
- **Version switcher's place.** `#reader-file-versions` sits between the header and the stage in the DOM, so Tab goes
  header (navigation, then the actions toolbar) → version switcher → Inspector (when open) → content → zoom pill →
  notes, matching what the eye reads top to bottom. The switcher's own menu is the menus stream's.

### Inspectors: board, item and opened Tinka as non-modal Dialogs (`r2/reader`)

Files: `side-panel.js` (new: `sidePanel`, `closePanel`), `canvas.js` (`boardInspector`, `readerInspector`,
`setInfoOpen`, `setReaderInfoOpen`, `renderReaderInfo` keeps the opening focus through its re-render),
`workspace-board.js` (`itemControls`, `closeContext`; four `closePanel($("board-info"))` calls), `board.html`
(`#board-info-dialog`, `#reader-info-dialog`). Component: Dialog, non-modal.

- **Why non-modal Dialog.** An Inspector is a working panel beside the board (or the opened Tinka), like the Navigator:
  the board stays usable around it. Not modal; not a Popover (hangs off its trigger, closes when focus leaves); not a
  Drawer (a modal sheet with a drag handle). Markup: `<ui-dialog modal="false" close-on-outside-press>` around
  `<ui-dialog-content inline class="calm-side …">`; `inline` keeps the panel's fixed place and stacking (no top layer).
  The SDK writes `role="dialog"`; the panel is named by its heading (`aria-labelledby`) or `aria-label`.
- **Focus on open:** the first control of the panel's body (`[data-initial-focus]`, marked by `sidePanel.open()`), not
  the header's × (the SDK's first focusable; the SDK's own examples put Close last). The item Inspector starts where
  its opener asks (Notes, the actions, Appearance), as before. Opened without focus (`focus: false`), nothing moves.
- **Escape** closes it while focus is inside, and focus goes back to the control that opened it (`final-focus`: the
  toggle, Details… on the selection bar), or, after ⌘I, to whatever had focus (a card, the canvas). Opened from a
  menu item that has gone, the item Inspector returns to the card's ⋯, else the card. With focus elsewhere, the
  board's and the reader's Escape ladders still close an open Inspector in their turn (focus stays put). Escape on an
  open Inspector's toggle closes it.
- **Tab** leaves the panel like any part of the page and the panel stays open (popups.md § Focus: "A non-modal dialog
  stays open"). Order: toggle (in the top bar's toolbar) → panel → the board. This is the SDK's documented non-modal
  behaviour, so last round's audit note ("Tab walks out into the canvas with the panel still open") is the norm, not
  a fault.
- **Outside press** closes it; a press on one of its openers is theirs (they toggle), and presses in what the panel
  opens (modal dialogs, menus, the feedback panel, the vote ballot) are not a click-away (`keepOpen`). A press into
  the opened Tinka's content (an iframe) is not seen by the page, as before.
- **Code that only knows `#board-info`** closes it with `closePanel()`; never write `hidden` on a panel the SDK owns
  (its state would not follow). Reading `.hidden` is fine. The item Inspector's element is removed a frame after it
  closes, once the SDK has returned focus; its id goes at once, so a new one never shares it.
- The panels' inner controls (segmented rows, swatches, toolbars) are the controls stream's.

### Top bars: navigation, then one toolbar of commands (`r2/reader`)

Files: `header-toolbar.js` (new: `headerToolbar`, `setItemDisabled`), `board.html` (`#chrome-actions` and the reader's
`.chrome-actions` are `ui-toolbar`), `canvas.js` (one call), `workspace-board.js` (Undo/Redo through
`setItemDisabled`; Undo/Redo inserted beside `tipOuter()` of the Inspector toggle). Component: Toolbar.

- **The split.** The left of each bar is navigation: the Navigator toggle, home, the parent crumb and the board title;
  in the reader also Up, the path and the stepper. Those are links and places, each its own Tab stop, as other apps'
  headers keep them and as the SDK's Navigation Menu does ("Tab moves through the triggers and top-level links in
  order, like any links on a page"). The right of each bar acts on what is shown: on a board Find, Undo, Redo,
  Inspector, Add ("Board actions"); in the reader Favorite, Notes, Find, Inspector ("Tinka actions"). Those are a
  `ui-toolbar`: one Tab stop (the item focused last), ←/→ along it with wrap, Home/End to its ends, Enter/Space press,
  ↓ opens Add's menu. The board's title is a heading, not a field, so nothing in the bar needs a text field's keys.
- **Wrapping as buttons arrive.** The bar's buttons come from the page, `workspace-board.js` and re-renders, so
  `headerToolbar()` wraps each in a `ui-toolbar-button` right around the button (inside any tooltip trigger, which must
  stay outermost), watching only the bar's own children. A button that is not rendered leaves the arrow order.
- **Disabled stays reachable.** Undo and Redo with nothing to undo are `aria-disabled` and stay in the arrow order
  (toolbar.md § Disabled: the SDK's default), instead of natively disabled and skipped. Set it with
  `setItemDisabled(button, on)`; writing `button.disabled` on a toolbar item would take it out of focus entirely.
- In the reader, ←/→ on the actions toolbar now move along it (`readerTinkaFocus` excludes `ui-toolbar`); `[` / `]`
  and ⌥←/→ still step from there, and plain ←/→ still step from the stepper and the canvas.

### Board map (`r2/reader`)

Files: `board-map.js` (`mapHeadToolbar`, Escape and `0` keys), `canvas.js` (`actualSize` and announced zoom keys),
`calm.css` (`.board-map-tools { display: contents }`), `workspace-board.js` (the board's key ladder steps aside for the
whole map, not only its stage). Component: Toolbar.

- **Head: a `ui-toolbar`** ("Map": Fit selected, Fit board, Close): one Tab stop, arrows along it. Gathered as the module
  loads, before tooltips wrap the buttons. No keycaps in the head (as decided in round 1).
- **Stage: left as `role="application"`,** with the reason: it is a 2-D pan-and-zoom surface drawn on one canvas; the SDK
  ships no element for it, and its Core viewport (`createViewport`) needs a primitive around the board, which the
  canvas stream has not adopted. `application` tells screen readers to pass the arrows through, which the stage needs.
  Its keys are the SDK viewport's: arrows pan, + / − zoom, **0 shows 100%** (new), each zoom announced in the board's
  live region ("Zoom 100%"). Pointer: click jumps, drag pans, wheel zooms, as before.
- **Escape anywhere in the map** (stage or head) closes it and focus goes to its toggle (the head is new; the stage did
  this already). A tooltip showing takes the first Escape.

### Sticker picker (`r2/stickers`)

Files: `emoji-picker.js` (the popup and the picker), `emoji-picker.css`, `emoji-search.js` (matching, skin tones);
openers in `workspace-board.js` (`openStickerPicker(anchor, point)` / `closeStickerPicker()`: the Edit tools' Sticker
key and the Add menu's Sticker row call it with themselves as the anchor). Components: Popover, Toggle Group, Segmented
Control. Core: `createVirtualizer`, `createPreference`, `createLocalStorage`. Tests: `tests/sticker-picker-browser.mjs`,
`tests/stickers.test.mjs`.

- **Popup: a non-modal `ui-popover`** made per open at the end of `<body>`, opened from code with `api.open({anchor})`
  against the opener: `side=bottom align=center side-offset=6 collision-padding=8`, so it flips above the Edit tools
  (they sit at the bottom) and shifts to stay 8 px inside the window at any width. Focus goes to the search field
  (`initial-focus`); Escape (after the query, below) and the opener's own press close it and focus goes back to the opener
  (focused just before opening, the SDK's rule for a popup opened from code). An outside press closes it and reaches what
  it hit, without taking focus back; focus leaving closes it. Tab order runs as if the picker followed its opener:
  Shift+Tab from the field goes to the opener, Tab from the grid goes on past the opener. The opener gets
  `aria-expanded` and `aria-controls` (the content's id) while it is open. The opener counts as part of the picker, as a
  popover's own trigger does: `openchange` for `outside-press` or `focus-out` caused inside it is cancelled, so its click
  toggles the picker closed, and Shift+Tab back to it leaves the picker open.
  Placing a sticker focuses and selects the new sticker, as adding any drawn element does; the picker closes because focus
  left it.
- **Field: a combobox over a grid** (`role=combobox`, `aria-haspopup=grid`, `aria-controls` the grid,
  `aria-activedescendant`). The caret stays in the field: ↓ starts a highlight on the first sticker; with a highlight the
  four arrows move it in two dimensions (← and → in reading order across row ends), PageUp/PageDown by the rows in view;
  ↑ from the first row ends the highlight, giving ← → back to the caret. Home and End move the caret (command.md). Typing
  highlights the best match, so Enter places it (combobox.md § Auto Highlight); Enter places the highlighted sticker.
  Escape empties the query first (the popover's `openchange` for `escape-key` is cancelled while there is one), then
  closes. Matching ignores case and accents (`words()` in `emoji-search.js`: NFKD, marks removed); the SDK's own
  matching is not used, because the ranking (exact name, name prefix, every word a prefix, favourites) is upstream's.
- **Grid: one Tab stop with one highlight.** `role=grid` > `role=row` > `role=gridcell`, focus stays on the grid and
  `aria-activedescendant` names the highlighted cell (Listbox's `virtual-focus` model, so the field and the grid share
  one highlight; `createGridFocus` moves real focus, which the field could not share). Keys are `createGridFocus`'s:
  arrows, Home/End for the row, Ctrl/⌘+Home/End for the first and last sticker, PageUp/PageDown, Enter or Space places.
  Entering the grid highlights its first sticker; a letter typed on the grid goes to the search field (the grid's
  typeahead is the search). Hovering highlights (one highlight for pointer and keys, as in menus); a click places, a drag
  onto the board places where it drops. The foot names the highlighted sticker (or counts the view); messages (no match,
  adding, failures) replace it in a `role=status`.
- **Long list: `createVirtualizer`** over rows (46 px each; columns measured from the grid's width, 7 at 344 px), with the
  highlighted row kept rendered (`keep`) and revealed with `scrollToIndex`. The whole view (a category or all search
  results, up to ~1,900) scrolls as one list; upstream's 108-per-page pages and their ‹ › buttons are gone. Cells carry
  `aria-rowindex` on rows and `aria-rowcount`/`aria-colcount` on the grid.
- **Categories: `ui-toggle-group deselectable=false`** of `ui-toggle` around our buttons: one Tab stop, ← → move focus
  without choosing, Space/Enter chooses, pressing the chosen one keeps it. While a search shows results the group's value
  is `[]` (set as a property, no event), so no category reads as chosen.
- **Skin tone: `ui-segmented-control`** (a radio group, `segmentedHTML`): default and the five tones, arrows check as
  they move. A chosen tone replaces each emoji that takes one with its one-tone variant (favourites and search results
  too); a query naming "skin" or "tone" still lists every variant, mixed tones included. Upstream's "Skin tones" button
  (show all five variants beside each emoji) is replaced by this choice. Remembered between visits and shared by every
  board: `createPreference` with `createLocalStorage('tinka/emoji-skin-tone')` (core.md § Preferences uses exactly this
  example; it insists on an `attribute`, which we don't apply anywhere).
- **Board keys.** The picker stops keydown from reaching the board (except Escape, which goes on to the popover); the
  board's capture handlers already step aside (`widgetOwnsKey`: `role=combobox`, `role=grid`, open popup content). The
  board's document Escape ladder (clear a drawn element's selection, the card selection) now returns for a key from
  inside open popup content (inPopup's rule, written inline because `workspace-board.js` doesn't import `popups.js` on
  this base; the experiment called `inPopup(e)` there): with a sticker selected it called `preventDefault` on Escape and
  the popover ignored it.
- **Shared fix in `canvas.js`:** the document click handler's `closest('[data-open]')` now asks
  `[data-open]:not([data-slot])` (as in the experiment): open popover content carries `data-open`, so any click in the
  picker (a category, a tone) opened an empty reader.
- **Performance** (headless, `team/ux/r2/stickers/perf.mjs`, press on the Sticker key to the first frame with cells, and
  keydown to the first frame showing new results; medians of 5 warm runs, three runs each): open 14–16 ms on both
  `main` and this branch (cold, first open with the catalogue import: 30–34 ms on both); keystroke to results 3.2 ms
  here, 3.3 ms on `main`. In page, the input handler costs 1.4 ms here against 2.2 ms on `main` (fewer cells: about 60 in view
  and overscan instead of a 108-cell page). The stylesheet is still loaded on first open; the picker waits for it
  before opening so the SDK places it at its final size.

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

### Update notice chip and popover (`update-notice.js`)

The chip ("Tinka 1.1 available") is rebuilt on every render, so it is no `ui-popover-trigger`: its popover is one shared
non-modal `ui-popover` (`sharedPopover`, `modal="false"`, `final-focus="none"`) opened from code with the chip as anchor,
content refilled per state (compatible, review, failed). The SDK supplies Escape, a press outside, focus leaving and
placement (below the chip, flipping above near the window bottom; width capped to the window). Focus: the chip is focused
as it opens, so the SDK's rule returns there; because the chip may be a new element by then, `openchangecomplete` focuses
`.update-chip` again after Escape or a code close (not after a press elsewhere). Tab: `content.tabTrigger` names the chip
so popups.js's Tab-out rule closes the popover and continues from it. The class `workspace-popover` stays on the content
so the board Inspector stays open while it is used. The major-update consent is a `ui-dialog` (focus starts on Later) and
the policy control a segmented control.

### Toolbars, toggles, segmented controls and value controls (`r2/controls`)

Files: `ui-toolbar.js` (`followVisibility`, toggle and choice helpers), `ui-segmented.js` (`segmentedHTML`, `setSegmented`,
`onSegmented`, `focusSegmented`), `workspace-board.js` (selection bar, tools rail, Layout, Pattern, item appearance),
`board.html` + `canvas.js` (the two zoom pills, map toggle, Pattern/Window/Light), `comment-pins.js` (the comment bar in the
pill), `whiteboard.js` (object and arrow bar, format panel), `container-layout.js`, `kind-legend.js`, `text-appearance.js`,
`color-control.js`, `preset-scrub.js`, `appearance.js`, `update-notice.js`, `home.js`/`home.html` (Sort), `workspace.js`
(item editor sections). Tests: `toolbars-browser.mjs` (the norms), plus the surfaces' own browser tests.

**Which component.** One question picks it:

- Buttons that act: `ui-toolbar` > `ui-toolbar-button` > `button`; a named set is `ui-toolbar-group`. One Tab stop on the
  item focused last, arrows along it (wrapping; Home/End), moving never presses. Every toolbar is a `ui-toolbar` and calls
  `followVisibility(toolbar)` when items come and go (hidden items leave the order).
- A button that stays down (Preview, the map, the tools rail): `ui-toggle` around the button. The app owns the state, so
  `onPress(toggle, fn)` cancels the SDK's flip and `setPressed(button, on)` writes the answer. **The answer must be
  written after the event returns** (the SDK restores a cancelled change when its `pressedchange` handler returns), so
  `onPress`/`onChoose` hand it over in a microtask. Writing a property fires no event.
- One of several keys, kept as real buttons so the theme's raised pressed-key look still draws (arrow route, text
  alignment, container layout, typeface, fill and border style, the tool choice): a single-choice `ui-toggle-group`
  (`deselectable="false"`). In a toolbar the group joins the arrows; Space/Enter chooses. `choiceHTML`, `setChoice`,
  `onChoice`/`onChoose` in `ui-toolbar.js`; the object bar's `barParts.choice`.
- One of a few options drawn as a track with a raised chosen cell (Layout, Pattern, Sort, Appearance rows, update policy,
  item editor sections, Window, Light, Version, Gap/Padding/Columns, Fill/Border role, the S/M/L presets): a
  `ui-segmented-control` (radio group): one Tab stop on the checked item, arrows check as they move.
- One chosen colour among swatches (every palette): `ui-radio-group` of `ui-radio` chips (`color-control.js`: `setSwatch`,
  `onSwatch`); arrows check as they move, the custom colour is a label with the system picker beside them.

**Non-obvious.**

- The SDK gives an item its role and tabindex a **microtask after** it is inserted (and reads its attributes then). A
  control just rendered is focused with `focusSegmented()` (or `queueMicrotask`), never synchronously. Property writes
  before that (`group.value = …`) are skipped: `setSegmented`, `setChoice` and `setSwatch` fall back to `default-value`.
- `valuechange` / `pressedchange` do not bubble but do pass the capture phase: listen on the element, or capture on a
  container (canvas.js hears every Pattern, Window, Light and Version copy from one capture listener on `document`; the
  object bar cancels its toggles' own flips with a capture listener, since it redraws what is pressed from the object).
- Segmented markup: `segmentedHTML()` makes `<ui-segmented-control class="tk-seg …">` so the theme's
  `.tk-seg > [data-slot=segmented-control-item]` rules apply. An item with a hint sits in its `ui-tooltip-trigger`
  (`tip:`), which is no longer a direct child of `.tk-seg`; those items still use the copied rule in `ui-sdk.css`
  (`.tk-seg > ui-tooltip-trigger > …`).
- The selection bar is built once and updated in place (count, Group/Restore labels, which actions show), so a focused
  action keeps focus across selection changes. The canvas tools rail is a `ui-toolbar`: Navigation (Pointer, Pan) and
  Feedback (Comment) are toggle groups, Draw is a `ui-toolbar-group` of buttons. The rail and map toggles are `ui-toggle`
  items of the view pill.
- A menu or panel button in a toolbar opens on ArrowDown (`openOnArrowDown`, now idempotent: a second handler for the same
  press does nothing). The object bar opens every `[aria-haspopup]` button this way by clicking it, as Enter would.
- **Scrub handle** (`preset-scrub.js`): a slider (spinbutton when unbounded) of its own, with the SDK slider's keys: arrow
  step, Shift+arrow and Page Up/Down large step (ten steps), Home/End bounds; it previews on every step or drag tick and
  commits once when the key comes up, the pointer lifts or focus leaves (closing the panel completes a step in progress, as before). It is not
  `ui-slider`/`ui-number-input` because it also edits a mixed value by a relative amount and previews on the canvas.
  Alt's small step is not offered: the values are whole pixels.
- Left as native, on purpose: standalone `aria-pressed` buttons that are not in a toolbar (Favorites, Last 6 weeks,
  Archive, auto height, automatic border) — a native toggle button already has the SDK toggle's keys; native radio
  fieldsets (`workspace-choice-pills`) — native radios are already one Tab stop with arrows that check.
