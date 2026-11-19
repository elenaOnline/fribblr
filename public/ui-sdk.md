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
