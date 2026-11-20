# How fribblr's interface is wired to UI SDK

UI SDK supplies the behaviour of every control in fribblr: keys, focus, dismissal, placement and ARIA. The look comes
from fribblr's tokens and depth model. This document says how to wire a new surface and how each existing surface
works. The code is the authority. If this document and the code disagree, fix the one that is wrong.

1. [UI SDK in fribblr](#1-ui-sdk-in-fribblr): what it is, where it lives, the rules
2. [Wiring a surface](#2-wiring-a-surface): one section per pattern
3. [Keys](#3-keys): who owns which key, the shortcut map, the rule for new shortcuts
4. [Surfaces](#4-surfaces): a catalogue of every surface
5. [Deliberately not on SDK components](#5-deliberately-not-on-sdk-components)
6. [Performance rules](#6-performance-rules)
7. [SDK gaps and workarounds](#7-sdk-gaps-and-workarounds), with the upgrade checklist

## 1. UI SDK in fribblr

### What it is and where it lives

- `@ui-sdk/web` 0.1.0-beta.10, Apache-2.0, vendored unmodified in `public/vendor/ui-sdk/` (served at
  `/app/vendor/ui-sdk/`). `VERSION` records the tarball and its sha1. Contents: the browser ESM build (`web.js`,
  `web.css`, `web/`, relative imports only), the docs (`docs/`, start at `docs/llms.txt`; components in
  `docs/components/`), `custom-elements.json` (every element's attributes, properties and events) and `LICENSE`.
- No build step and no npm dependency. Modules import the vendored files directly.
- The team's behaviour spec, written from the SDK docs and source, is `team/ux/sdk/SPEC.md` in the project folder,
  outside this repository. Section references below are to the vendored docs.

The glue, all in `public/`:

| File | Holds |
|---|---|
| `ui-sdk.js` | `widgetOwnsKey`, `sdkPopupOpen`, `defined`, the undocumented globals (`toaster`, `shortcuts`), the restyle-cost rewrite of the SDK's injected CSS |
| `ui-sdk.css` | `@layer ui-sdk;`, the hide-until-defined rule, display rules for wrapper parts, segmented-control and tooltip looks |
| `popups.js`, `popups.css` | Menus and popovers: `sharedMenu`, `sharedPopover`, `openMenu`, item builders, `inPopup`, `menuOpen`, `openOnArrowDown`, `tabOutOfPanel`, the consumed-press guard, Tab out of body-level popups; the menu looks |
| `tips.js` | The shared tooltip, `tip`, `tips`, `tipTrigger`, `tipOuter`, `setTip`, `tooltipOpen`, the delegate |
| `toasts.js` | `toast`, `dismissToast` (re-exported by `workspace.js`) |
| `ui-toolbar.js` | `followVisibility`, `setPressed`/`onPress`, `choiceHTML`/`setChoice`/`onChoice`/`onChoose` |
| `ui-segmented.js` | `segmentedHTML`, `setSegmented`, `onSegmented`, `focusSegmented` |
| `header-toolbar.js` | `headerToolbar`, `setItemDisabled` |
| `side-panel.js` | `sidePanel`, `closePanel` |
| `reader-dialog.js` | `trapTab`, `tabStops`, `rememberOpener`, `openerToReturnTo` |
| `home-board-list.js`, `order-list.js` | The two collection primitives (`fr-board-list`, `fr-order-list`) |
| `board-focus.js` | `BoardFocus`: keyboard focus on the board's items; `sdkCore`, `announce` |
| `color-control.js` | Swatch palettes as `ui-radio-group` (`setSwatch`, `onSwatch`) |
| `workspace.js` | `makeDialog`, `confirmDialog`, `newBoardDialog` |
| `reconcile.js` | `reconcileChildren`, which leaves part-managed attributes alone |

### The rules

1. **Import the entry for each component** at the top of the module that builds the surface:
   `import './vendor/ui-sdk/web/menu.js';` (relative to `public/`). Every import uses the vendored path, so one copy of
   the code loads. Don't use the autoloader (`web.js`): it upgrades a tag after insertion, asynchronously, so code that
   reads `.api` right after inserting races it. Before reading `.api` or setting properties on a fresh element,
   `await defined('ui-menu')` (`ui-sdk.js`, a wrapper around `customElements.whenDefined`).
2. **Wrap our own elements.** Parts are light-DOM custom elements. Triggers, Close parts and toolbar or toggle parts
   wrap our existing `<button>` and are `display: contents`; behaviour, ARIA and `data-*` state land on the button.
   Keep the existing classes on our elements so the theme still applies. `as-child` makes a part bind its first child
   (a menu item that is an `<a>`). Parts write the attributes they manage (roles, ids, `aria-*` state, roving
   `tabindex`); never write those yourself. Our own primitives' tags are `fr-*`.
3. **Style from tokens and the depth model, never from the SDK.** Don't link `vendor/ui-sdk/web.css`. `ui-sdk.css` is
   linked first on `board.html` and `home.html` (the document reader prepends it at runtime; `item.html` loads no SDK)
   and declares `@layer ui-sdk;`, so every unlayered rule of ours wins over the few rules the SDK injects
   (closed popups hidden, default display). Popup content floats: `data-height="float"` or an existing float class
   (`depth.css` lists them). Keys stay raised. State styles key off the SDK's attributes (`data-open`,
   `data-highlighted`, `data-checked`, `data-pressed`, `data-disabled`, `data-pending`, `data-side`), never generated
   ids. `tokens.css` and `depth.css` belong to the theme: interface work never edits their values or rules, and
   never copies their look into `ui-sdk.css` or a surface's stylesheet. When an SDK part needs a theme rule, ask for
   the theme rule to name it by `[data-slot=…]` (as `.tk-seg > [data-slot=segmented-control-item]` does). Focus rings use native `:focus-visible` on the element that
   receives the behaviour.
4. **Change events don't bubble, do pass the capture phase, and are cancelable** (`openchange`, `valuechange`,
   `pressedchange`, `checkedchange`, `pagechange`). `detail` is `{value, reason, event, source}`. Listen on the element,
   or capture on a container. Setting a property or attribute fires no event, so writing our model back never echoes.
5. **Popup events bubble to the popup's DOM ancestors** (`docs/popups.md`). Popup roots and content live at the end of
   `<body>` (or inside the modal `<dialog>` that hosts them), never inside a card, a toolbar or any clickable container.
6. **`data-open` is the SDK's open-state attribute** on triggers and content. The app's own `data-open="<key>"` (open
   this item) predates it. Selectors for the app's meaning are `[data-open]:not([data-slot])` (`canvas.js` click
   handler, `board-document.js`, `board-focus.js`). A bare `closest('[data-open]')` treats a click inside any popup as
   "open that item".
7. **Open-dialog checks** ask for both kinds: `dialog[open],ui-dialog-content[data-open][aria-modal=true],
   ui-alert-dialog-content[data-open]` (`MODAL_OPEN` in `workspace-board.js`; the same string in `canvas.js` and
   `home.js`), and `.workspace-dialog:is([open],[data-open])` where code asked for `dialog.workspace-dialog[open]`.
   The `aria-modal` part matters: the SDK writes `aria-modal="true"` only on modal dialogs, and the non-modal ones
   (Navigator, Quick jot, the Inspectors) must not pause the board.
8. **Board-level key handlers step aside** for SDK widgets: § 3.
9. **Undocumented globals** (the toaster, the shortcut registry) are reached only through `ui-sdk.js`, so a version
   bump is a one-file check.
10. **Nothing per card.** No SDK element or binding is added per card or per drawn element on the board: § 6.
11. **Testing** follows `AGENTS.md`: `npm test`, browser checks headless only. Each surface has a browser test in
    `tests/` (`toolbars-browser.mjs` covers the toolbar norms, `tooltips-browser.mjs` the tooltip).

## 2. Wiring a surface

### Popups: menus and popovers

Helpers in `popups.js`, looks in `popups.css` (linked last on `board.html` and `home.html`).

**Which component.**

- A list of actions or choices is a `ui-menu`: plain, checkbox and radio items, groups, separators, link items.
- Anything holding a field, a slider, a segmented control or other controls is a `ui-popover` (menu.md § Keyboard
  Navigation: a menu holds items only). A colour choice in a menu is an item that opens the system picker.
- A single choice shared by triggers that are rebuilt per card is a menu radio group opened with `openMenu`, not a
  `ui-select` (§ 7, gap 4). A `ui-select` is fine for one fixed trigger (the Navigator's scope).

**Opening.**

- A fixed button reaches its popup with `<ui-menu-trigger for="id">` / `<ui-popover-trigger for="id">` around our
  button; inside a toolbar, `<ui-toolbar-button><ui-menu-trigger for="id"><button>`. The SDK then writes
  `aria-haspopup`, `aria-expanded`, `aria-controls`, opens on click, Enter, Space, ↓ and ↑, and returns focus. Don't add
  those attributes or a click handler.
- A button rebuilt with its container (a card's ⋯, a drawn-object bar button) and every point-anchored context menu
  open the popup from code, and that code writes the opener's `aria-haspopup` and `aria-expanded` itself (as
  `tileMenu` and `arrangeMenu` do).

```js
import {sharedMenu, openMenu, menuItem, menuSeparator} from './popups.js';

const ui = sharedMenu({id: 'workspace-tile-menu', className: 'workspace-tile-menu'});   // appended to <body>
ui.root.addEventListener('action', e => run(e.detail.value, ui.root.api.getPayload()));

function open(button, event, placementId) {
  ui.content.innerHTML = menuItem('open', 'Open', {shortcut: 'enter'}) + menuSeparator
    + menuItem('duplicate', 'Duplicate', {shortcut: 'mod+d'});
  ui.content.setAttribute('aria-label', 'Actions for …');
  openMenu(ui.root, {anchor: button, event, payload: placementId});
}
```

- `sharedMenu({id, label, className, host, contentId})` makes a `ui-menu` with `ui-menu-content.tk-menu` in `host`
  (default `<body>`) and returns `{root, content}`. It joins the consumed-press guard and the focus rules below.
  `sharedPopover({id, label, className, host})` makes a `ui-popover` whose content has `data-height="float"`.
- `openMenu(root, {anchor, payload, event, focus, returnTo})`. `anchor` is an element, an `{x, y}` point, or an object
  with `getBoundingClientRect()` (use that when the button may re-render while open). `payload` is read with
  `api.getPayload()`. `returnTo` is a selector that finds the opener again after a re-render; by default the anchor
  element, the pressed control or the focused element is marked `data-menu-return` and found by that. `focus`
  defaults to `openFocus(event)`: a keyboard open focuses the first item (↑: the last), a pointer open focuses the
  menu itself.
- **A menu stays inside the window.** The SDK shifts a popup back into view only as far as it still touches its anchor,
  so an anchor past the window's edge (the ⋯ of a card the board shows half, then Shift+F10) took the menu past the
  edge. `openMenu` passes such an anchor (element or rect) clamped into the window less the content's
  `collision-padding`, along the axis it runs past (`inWindow`). An anchor inside the window goes as it is, even
  inside a large padding that only keeps the menu clear of a bar (the comment cluster's), and so does a point.
- One menu element serves every card. Fill its content just before opening.
- A popover opened from code: `root.api.open({anchor})`.

**Item builders.** `menuItem(value, label, {shortcut, disabled, destructive, icon, tip, className, attrs})`,
`menuLink(href, label, {target, className})`, `menuCheckbox(value, label, {checked, shortcut, disabled, tip})`,
`menuRadioGroup(name, label, [[value, text, {detail}]…], value, {disabled, tip, closeOnSelect})`,
`menuGroup(label, items)`, `menuSeparator`. `shortcut` uses the SDK notation (`"mod+d"`, `"e"`, `"shift+1"`): it writes
`aria-keyshortcuts` and a `<kbd class="tk-kbd">` keycap (⌘ on Apple platforms, Ctrl elsewhere), which also tells
`keycaps.js` the row prints its key. HTML items only display a shortcut; the board's own handlers run it. Radio items
stay open as they change unless `closeOnSelect`. A checkbox item that stays open must have its `checked` attribute
written back after a toggle, or the SDK puts it back.

**Focus.**

- Escape, a chosen item and Tab send focus back to the opener. For a shared menu, `openMenu` focuses the opener just
  before opening (the SDK returns a code-opened menu's focus to "the element focused before"), and if the opener was
  re-rendered while open, `openchangecomplete` finds the new copy through `returnTo`. A shared menu that closes with
  focus still on one of its closed rows (a click away whose press was swallowed) also returns focus to its opener. Tab
  in a shared menu focuses the opener first, so the browser's Tab continues from there.
- **A press away puts focus where the press would have put it.** The SDK leaves focus alone when the outside press
  lands on something focusable (popups.md § Focus: "Closing because focus moved away never moves it back, and neither
  does pressing something focusable outside"), expecting the press to focus it. But a menu swallows that press, and the
  board prevents native focus on the canvas, so focus fell to `<body>`. `popups.js` records each popup's outside press
  and, once the popup has closed with focus on `<body>` or still inside it, focuses what `focusAfterOutsidePress(resolve)`
  names for the press (the board registers one: the pressed item, else the canvas, `pressedKey` in
  `workspace-board.js`), else the focusable element pressed, else the popup's trigger (a press on the bare top bar; the
  SDK's own deferred return doesn't happen for a `for=` trigger in 0.1.0-beta.10). Every menu, popover and side panel
  follows it, with no per-popup code: a click on empty canvas from Add, the Comments count, the % popover or a card's ⋯
  leaves the canvas focused. Checked in `tests/last-fixes-browser.mjs`.
- A non-modal popover or dialog at the end of `<body>` (or of the reader dialog) is steered by a document Tab
  listener in `popups.js`: Tab from its last control closes a popover and focuses its trigger, so the browser's Tab
  continues after the trigger; Shift+Tab from the first control focuses the trigger. The trigger is found through
  `ui-popover-trigger[for]`, `ui-dialog-trigger[for]`, or a button with `aria-controls` naming the content. A popup
  whose trigger the page can't point at sets `content.tabTrigger = () => element`.
- A panel the app places itself (the drawn-object bar's format panels) calls
  `tabOutOfPanel(event, content, trigger, close)` from its keydown for the same rule.
- A popup whose opener is not a `for=` trigger treats the opener as part of the popup: cancel `openchange` with
  reason `outside-press` or `focus-out` when `detail.event.target` is inside the opener, so the opener's own click
  toggles it closed (sticker picker, comment name popover, vote ballot, Navigator).

**Menu buttons in a toolbar** open on ↓: `openOnArrowDown(toolbar, selector, open)`, delegated on the toolbar so it
survives re-rendered buttons. It does nothing for a press another handler already took.

**Context menus.** Our own `contextmenu` listener calls `openMenu` with the pointer. Shift+F10 and the context-menu key
fire `contextmenu` with no right button: `keyboardContextMenu(event)` detects that, and the menu then opens under the
focused item's ⋯ or at the canvas centre. A second right-click re-anchors: the first press closes the menu (consumed),
the `contextmenu` that follows opens it at the new point.

**The consumed press.** A menu's default `modal="pointer"` swallows the click of the outside press that closes it, but
the `pointerdown` still reaches the board, which would select or drag the card under it. Every `sharedMenu()`, and any
menu passed to `guardMenu(root)`, records that press, and a document capture listener in `popups.js`, registered
before the board's, stops it. Board handlers that run earlier, on `window` capture, check `menuOpen()`.

**Looks** (`popups.css`). Menu content gets `.tk-menu` (the menu face and the float height); items keep `.tk-mi`,
separators `.tk-msep`, group labels `.tk-mlabel`, a second line `.tk-mi2`. `popups.css` removes the UA popover box
that Menu content keeps, lights the highlighted item from `data-highlighted` only (`:hover` alone does not, so pointer
and keys never light two rows), draws no focus ring on menu items (the fill is the indicator, as in native menus;
the rule names `:root`, the content's `[data-slot]` and the item's role so it outweighs the theme's ring on
`[tabindex]:focus-visible` in `tokens.css`, which it otherwise lost to),
shows checks from `data-checked`, and caps size at `--available-height`. Where an old class set `display` or
`position` on the hand-rolled popup, `popups.css` puts back `revert-layer`, or a closed popup would show.

**Pitfalls.**

- Content inside a card or toolbar: every click in it reaches the card's handlers.
- A board handler reacting to `[data-open]` without `:not([data-slot])`.
- A shared menu without the guard: the closing press selects or drags whatever is under it.
- A menu holding a text field: use a Popover.
- Letters inside a menu are typeahead, never board shortcuts (§ 3).

### Toolbars and toggle groups

**Which component.** One question picks it:

| What the controls are | Component | Glue |
|---|---|---|
| Buttons that act | `ui-toolbar` > `ui-toolbar-button` > `button`; a named set inside is `ui-toolbar-group`; a link is `ui-toolbar-link` | `followVisibility(toolbar)` |
| A button that stays down (Preview, the map, auto height) | `ui-toggle` around the button | `onPress`, `setPressed` |
| One of several keys kept as real buttons (arrow route, alignment, typeface, fill style, the tool choice, a vote) | single-choice `ui-toggle-group deselectable="false"` of `ui-toggle` > `button` | `choiceHTML`, `setChoice`, `onChoice` / `onChoose` |
| One of a few options drawn as a sunken track with a raised cell | `ui-segmented-control` | `ui-segmented.js` (next section) |
| One colour among swatches | `ui-radio-group` of `ui-radio` | `setSwatch`, `onSwatch` |

A toolbar is one Tab stop on the item focused last; arrows move along it (wrapping), Home/End jump; moving never
presses; Enter/Space press. `ui-toolbar-button`, `ui-toolbar-link` and `ui-toggle` are `display: contents`, and
`ui-toolbar`, `ui-toggle-group` and `ui-toolbar-group` are `display: flex` (`ui-sdk.css`), so our buttons lay out as
before. A toggle group inside a toolbar joins its arrow order.

```js
import {followVisibility, setPressed, onPress} from './ui-toolbar.js';

bar.innerHTML = `<ui-toolbar-button><button type="button" data-act="fit">Fit</button></ui-toolbar-button>
  <ui-toggle><button type="button" data-act="map" aria-label="Map">…</button></ui-toggle>`;   // bar is a ui-toolbar
followVisibility(bar);
const mapToggle = bar.querySelector('ui-toggle');
onPress(mapToggle, on => setMapOpen(on));             // the app decides
// wherever the map opens or closes, by any route:
setPressed(mapToggle, mapIsOpen);                     // property write, no event
```

- **Items that come and go.** The SDK doesn't know an item can be absent (`hidden`, or a media query): it stays a Tab
  stop and an arrow stop. `followVisibility(toolbar)` marks every `ui-toolbar-button` whose button is not rendered as
  disabled and not focusable (`focusable-when-disabled="false"`), and restores it when it shows. It watches the
  toolbar with a `MutationObserver` (`hidden`, `class`, `style`), a `ResizeObserver` and window `resize`, batched to
  one frame. Call it on every toolbar whose items come and go.
- **Buttons that arrive from several modules.** `headerToolbar(toolbar)` wraps each `button` directly inside the
  toolbar in a `ui-toolbar-button` as it arrives (inside any tooltip trigger, which stays outermost), then applies
  the same visibility rule. Used for the two top bars and the board map head.
- **Disabled stays reachable.** In a `headerToolbar`, `setItemDisabled(button, on)` marks the item `aria-disabled`
  (the SDK's default for toolbar items): it stays in the arrow order and ignores presses. Writing `button.disabled`
  on a toolbar item takes it out of focus entirely. Outside a `headerToolbar`, `setItemDisabled` writes
  `button.disabled`. Elsewhere, an `aria-disabled` button inside a `ui-toolbar-button` behaves the same way (Fit
  height once, Reload while busy). It looks disabled too: a rule at the end of `calm.css` lays an `aria-disabled`
  top-bar key flat in the frame with a hairline, as `depth.css` draws `:disabled`, and dims its icon to 40 % of
  `--ink-2` over `--surface-frame`, as main dims a disabled top-bar key (Undo and Redo with nothing to undo).
  The depth model has no `[aria-disabled]` rule of its own yet; the theme is asked for one, which would replace this.
- **Buttons the app disables.** The SDK owns a toolbar button's `disabled` attribute and writes it from its part; a
  natively disabled button behind an enabled part is an arrow stop focus can't land on, so the arrows stop there.
  Disable such a button through its part with `setButtonOff(button, off)` (`ui-toolbar.js`): the part leaves the arrow
  order (`focusable-when-disabled="false"`) and the SDK writes `disabled` on the button, so code and tests that read
  `button.disabled` are unchanged (the board Inspector's Edit row). A toolbar that is not rendered at all (in a closed
  panel) keeps its items as they are, and `followVisibility` reads them again when it shows: marking them disabled then
  made the SDK write `disabled` on every button of a closed Inspector.
- **Vertical toolbars** lay out as a column from the authored `orientation="vertical"` as well as the SDK's
  `data-orientation` (`ui-sdk.css`): the SDK writes the latter a microtask after the element arrives, and a panel
  measured in between (Shape options) took its rows for one line and sized itself short.
- **App-owned state.** `onPress(toggle, fn)` cancels the SDK's flip and calls `fn(requested)`; the app writes its answer
  with `setPressed(el, on)`. `onChoose(group, fn)` does the same for a toggle group, `setChoice(group, value)` writes
  it. The answer must be written after the event returns, because the SDK restores a cancelled change when its
  handler returns; `onPress` and `onChoose` hand over in a microtask. `onChoice(group, fn)` is for a group the SDK
  may change itself (no cancel).
- **`choiceHTML({label, className, value, items, attrs})`** builds a single-choice, non-deselectable toggle group of
  buttons; each item `{value, html|label, ariaLabel, tip, className, attrs}`. The pressed button carries `aria-pressed`,
  so the theme's raised-key look still applies.
- **Toolbars inside a card** don't use `ui-toolbar`: § Board canvas, "Toolbars inside an item".

**Pitfalls.**

- A tooltip trigger goes outside the toolbar part: `<ui-tooltip-trigger><ui-toolbar-button><ui-menu-trigger><button>`.
  Insert siblings next to `tipOuter(button)`, or they land inside a wrapper.
- `pressedchange` and `valuechange` don't bubble. A container that redraws pressed state from its own model (the
  drawn-object bar) cancels the toggles' flips with one capture listener.
- A toolbar inside a reader surface makes ←/→ move along the toolbar; `readerTinkaFocus` in `canvas.js` excludes
  `ui-toolbar`, `ui-toggle-group` and `.tk-seg` so those arrows don't step to another Tinka.

### Segmented controls and radio groups

```js
import {segmentedHTML, setSegmented, onSegmented, focusSegmented} from './ui-segmented.js';

host.innerHTML = segmentedHTML({label: 'Layout', className: 'board-layout', value: 'canvas',
  items: [{value: 'canvas', label: 'Canvas'}, {value: 'grid', label: 'Grid', tip: 'Cards in rows'}]});
const seg = host.querySelector('ui-segmented-control');
onSegmented(seg, value => setLayout(value));   // she chose (pointer or arrows)
setSegmented(seg, current);                    // our model back, no event
focusSegmented(seg);                           // focus the checked item, after the SDK has given it a role
```

- `ui-segmented-control` is a radio group: one Tab stop on the checked item, arrows check as they move, named by
  `aria-label` or `aria-labelledby`. `segmentedHTML({label, labelledby, className, id, attrs, items, value})`, items
  `{value, html|label, tip, ariaLabel, id, disabled, attrs}`.
- The markup carries `class="tk-seg"`, so the theme's rules for `.tk-seg > [data-slot=segmented-control-item]` in
  `tokens.css` and `depth.css` draw it (the chosen item is the raised cell, keyed on `data-checked`). Nothing is
  copied into `ui-sdk.css`, which only adds layout, `user-select: none`, and a 44 px minimum width inside the zoom
  menus. Surface CSS that sized `.tk-seg > button` names both: `.tk-seg > :is(button, ui-segmented-control-item)`.
- No `ui-segmented-control-indicator`: the raised cell is the item's own face, so nothing slides.
- An item's hint (`tip`) is a `data-tip` on the item, served by the tooltip delegate, so every item stays a direct
  child of `.tk-seg`.
- **Swatches**: `ui-radio-group` of `ui-radio` chips (`color-control.js`, `setSwatch(palette, id)`,
  `onSwatch(palette, fn)`); arrows check as they move; the custom colour is a label with the system picker beside them.

**Pitfalls.**

- The SDK gives an item its role and `tabindex` a microtask after insertion (and reads its attributes then). Focus a
  just-rendered control with `focusSegmented()` (or after `queueMicrotask`), never synchronously.
- A property write before upgrade is lost. `setSegmented`, `setChoice` and `setSwatch` fall back to writing
  `default-value` when the element has no `api` yet.
- Arrows in a radio group check as they move. Where every choice writes at once and moving focus must not choose
  (the vote ballot), use a toggle group.
- To hear every copy of a control at once, capture `valuechange` on a container: `canvas.js` hears Pattern, Window,
  Light and Version from one capture listener on `document`, so the zoom popover and the Inspector stay in step.

### Dialogs and alert dialogs

```js
import {makeDialog, confirmDialog} from './workspace.js';

const content = makeDialog('Rename', `<label>Title<input name="title" required></label>
  <button type="submit" class="workspace-primary">Save</button>`, async data => save(data.get('title')),
  {opener: button, compact: true});
content.addEventListener('close', () => {/* closed */});

if (await confirmDialog({title: 'Remove 2 cards?', confirmLabel: 'Remove', onConfirm: () => remove(ids)})) {/* done */}
```

- **`makeDialog(title, body, onSubmit, {opener, compact, shortcutHint, onDismiss, className})`** builds a modal
  `ui-dialog` and returns the `ui-dialog-content` (class `workspace-dialog`), which has `close()` and fires a `close`
  event once closed. The submit button moves into `footer.workspace-dialog-actions` with its hint (a keycap, or
  `shortcutHint` as words); ⌘↩ saves (`bindForm`). Focus opens on `[autofocus]`, else the first field, else the close
  key. "The first field" skips a field inside a hidden part (the Move dialog's New board name until New board… is
  chosen: autofocus there left focus on ×) and counts a choice: a radio group is entered on its checked radio, else
  its first (`firstField` in `workspace.js`), so Move to a board opens on its destinations. Tab wraps; Escape and a backdrop press close; focus returns to `opener` (default: the focused element). A
  save in flight holds the dialog open. The return runs a frame after the SDK's own (so a caller's `close` listener has
  the last word); if another dialog has opened and taken focus in that frame (Enter on the opener again, at once), it
  keeps it, unless that dialog holds the opener (a dialog opened from another). Before, the late return pulled focus
  out of the new dialog onto the opener behind it, and the next Space opened a second copy.
- **Discard question.** Only typed text asks. Once a text field or text area of a form with `onSubmit` holds text that
  differs from what it held before her first edit (noted on `beforeinput`), the dialog becomes `dismissible=false`;
  Escape or a backdrop press then asks, in an alert dialog titled "Discard the text you typed" ("Nothing in “Edit item”
  is saved yet.", Keep editing / Discard). A choice (radio, checkbox, select, slider) never asks: it costs one press to
  make again (the Move to a board destination). Text typed back to what it was asks nothing. The title is a statement,
  not a question (plain, literal copy). The × key never asks. A dialog with
  `onDismiss(form)` keeps its draft instead and never asks; `onDismiss` runs as it closes unsaved, at once, so a
  dialog reopened straight away finds the draft.
- **`confirmDialog({title, description, confirmLabel, cancelLabel, onConfirm, className})`** builds a
  `ui-alert-dialog` and resolves `true` for the confirming answer. Focus opens on Cancel, Escape means no, a backdrop
  press does nothing. An async `onConfirm` keeps the dialog open with the confirm key pending and shows a failure
  inside it. Its title is a statement, never a question (her copy rule): "Archive these boards everywhere", "Remove
  from this board", "Update to Tinka 2.0". The same holds for every dialog title and for the lines beside its buttons.
- **Nesting.** Both append to the topmost open modal (`ui-dialog-content[data-open][aria-modal=true]`,
  `ui-alert-dialog-content[data-open]`, or a modal `<dialog>` such as the reader), otherwise that parent's inert page
  would include the new dialog.
- **Hand-built `ui-dialog`.** A dialog with its own markup (agent prompt, update consent, Home's legacy `#new-dialog`)
  uses `ui-dialog` > `ui-dialog-backdrop` + `ui-dialog-content`, `ui-dialog-title as-child`, `ui-dialog-close`. Mark
  the starting control `autofocus`.
- **Non-modal panels** are `ui-dialog modal="false"` (Navigator, Quick jot). For a panel in a fixed place, add
  `inline` to the content so it keeps its place and stacking instead of moving to the top layer; side panels use
  `sidePanel()` (§ Inspectors).
- A closing popup stays shown until its animations end. A panel that slides in and has no exit animation finishes its
  animations in `openchange` so it closes at once (Navigator, `sidePanel`).

### Toasts

```js
import {toast, dismissToast} from './workspace.js';
const id = toast('Removed 2 cards.', {action: {label: 'Undo', onAction: undo}});
```

- `toast(message, options)` is the only call-site API. It is synchronous and returns the toast's id; options are the
  SDK's (`type`, `action {label, onAction}`, `duration`, `id`, `priority`, `onDismiss`). Duration defaults to 6 s.
  `dismissToast(id)` closes one (all, with no id).
- `toasts.js` builds one `ui-toast-region.workspace-toasts` per page on first use (bottom centre, labelled
  "Notifications") with a template holding the title, an action button and a close button, and gives it the SDK's
  default toaster through `toaster()` in `ui-sdk.js`.
- The SDK supplies stacking (three visible), timers that pause while the pointer or focus is in the stack or the
  window is inactive, F6 to reach the newest toast, Escape to dismiss it, swipe, and announcements.
- Live regions that are not toasts (connection status, form status) are not routed through here.
- Tests find toasts by `.workspace-toast`. Several can show at once: use `.first()`, `.last()` or a filter.

### Tooltips

One shared tooltip per page (tooltip.md § Shared): `<ui-tooltip id="tk-tip">` at the end of `<body>`, made on first
use, and one per modal `<dialog>` with an id (`reader-dialog-tip`), because the rest of the page is inert while it is
open. A control carries its hint as `data-tip="…"`; the content reads `data-tip` from the payload (the control) on
`payloadchange`. No native `title` is used for a control hint.

A control reaches the tooltip in one of two ways:

- **Wrapped** (the chrome: headers, pills, toolbars, the Inspectors' own keys). The control sits in
  `<ui-tooltip-trigger for="tk-tip">` whose `payload` is the control, so every norm is the SDK's own. Write
  `data-tip`, then call `tips(container)` after rendering (idempotent). In reconciled markup, write the wrapper with
  `tipTrigger(html)` and call `tips()` after the render to set its payload.
- **Delegated.** A control inside a tooltip zone carries only `data-tip` and gets no wrapper. Zones are
  `[data-tip-zone]`, `ui-segmented-control`, `ui-radio-group` and `ui-pagination`. Form fields (`input`, `select`,
  `textarea`) are always delegated, because the trigger writes `type="button"` on its control, which turns an
  `<input type=range>` into a button. One set of document listeners opens the shared tooltip for these through the
  controller, `api.open({anchor, payload})`. `[data-tip-zone]` is set on `#world` (cards, drawn-element handles,
  comment pins, the legacy canvas), the Navigator panel, the comment card, the sticker picker, the document reader's
  tools, the Inspector's Background row and the reader's window. A `[data-tip]` outside a zone that has no wrapper yet
  (rendered after `tips()` ran, or a menu row) is served by the delegate too.

**Markup rules.**

- Change a hint with `setTip(el, text)`; an open tooltip follows. Inside a zone, writing `el.dataset.tip` is enough.
- `data-tip=""` keeps a control silent (the Background row, the reader window at Fit).
- `data-tip-truncated` shows the hint only while the text is cut off, sideways (ellipsis) or downwards (line clamp).
  Its value may name the descendant that truncates: `data-tip-truncated=".navigator-name"`.
- A wrapped trigger is the outermost wrapper: `<ui-tooltip-trigger><ui-toolbar-button><ui-menu-trigger><button>`.
  Insert siblings next to `tipOuter(control)`.
- Menu helpers take `tip` (`menuItem(…, {tip})`); a menu row's hint opens on hover only.
- **Names.** Every trigger of a shared tooltip needs a name of its own, so the tooltip describes it and never labels
  it. `tip()` adds `aria-label` from the hint when a wrapped control has no name. Where the hint only repeats the
  name, its words are `aria-hidden` inside the content.
- **Shortcuts** come from the control's `aria-keyshortcuts`, showing only this platform's ("Meta+K Control+K" shows ⌘K
  on a Mac), as `<ui-tooltip-shortcut>` parts hidden from screen readers, printed as the app prints keycaps
  (`capLabel` in `keycaps.js`), joined with "or". Hint text never carries keys. A labelled `tk-btn` with
  `aria-keyshortcuts` prints a visible keycap (`keycaps.js`); where the tooltip must name keys the button doesn't
  print, put them in `data-tip-keys` (the map head's Fit buttons, Comments, the reader's Down).

**What the delegate reproduces** (tooltip.md § Delay and Grouping, § Keyboard, § Tested Behavior; source
`web/chunks/CpFjFmpa.js`, `BT526ott.js`):

- 600 ms of rest before the first opens. While a tooltip is open, or closed less than 400 ms ago (the SDK's group
  window), the next opens at once. Opening one closes the other, and the SDK's group marks the instant one
  `data-instant`, so wrapped and delegated controls hand over to each other.
- Leaving the control closes it at once, unless the pointer is inside the convex hull of control and tooltip, 4 px out.
- Keyboard focus opens it at once; a click that focuses does not (the SDK's modality rule: the last input was a key,
  not a lone modifier, or Tab; a window blur mutes it until the next key). Focus leaving closes a tooltip focus opened.
- Focus the app places opens nothing: focus that a key moved off the control it was pressed on, other than by walking
  (Tab; arrows, Home, End, Page Up/Down inside a group; a typed letter), such as a panel's starting control after
  Enter, focus handed back after Escape, or the drawing bar after Option-F10, and an arrow that leaves its group (↓ on
  a bar button opening its panel). Nobody walked there, and a hint on it would take the first Escape meant for the
  panel. Tab and arrows inside a group still open hints at once, and there the SDK's rule stands: Escape closes only
  the tooltip. This applies to the delegate's focus opens and, through `openchange`, to wrapped triggers.
- A press (pointer down, Enter, Space) closes it; after a press it stays closed until the pointer leaves. The board
  and the drawn-object bar stop `pointerdown` on document capture, before the delegate's listener and a wrapped
  trigger's own hear it, so the press is also read on **window** capture: a press on the control whose tooltip shows
  closes it, delegated or wrapped (the bar's buttons, the tools rail). A wrapped trigger pressed that way is held quiet
  (`holdQuiet`): the tooltip cancels its `trigger-hover` opens until the pointer moves off it, and a trigger rebuilt
  under the resting pointer (the rail redraws its pressed tool) hands the hold to its replacement.
- A popup opening closes it, whatever opened the popup (a press, a key, code), and the control under the pointer,
  delegated or wrapped, counts as pressed (tooltip.md: pressing the trigger closes the tooltip, "pressing opens the
  popover instead"). `tips.js` watches every non-tooltip `openchange` on `document` (capture) for this (§ 7, gap 23).
  A panel the app places itself reports its open and close the same way: `reportPanel(panel, open)` in `popups.js`
  dispatches a bubbling `openchange` from it (the drawn-object bar's format panels in `whiteboard.js`), so the panel
  opening closes its button's tooltip and the focus that returns to the button as it closes reopens none.
- Escape closes only the tooltip. A controller open sits in no SDK layer, so the delegate takes the press (document
  capture) and stops it; the board's handlers have already stepped aside (`widgetOwnsKey`, `inPopup`).
- Touch never opens one. Only the control that opened it is described by it (`aria-describedby` set while open,
  restored on close).
- Cases the SDK has no rule for: a pointer moving with a button held (drag, marquee) opens nothing; a control that
  leaves the page while its tooltip shows closes it (the anchor is read on every placement check); an iframe inside a
  hinted element is the page it shows, so the reader window's hint shows over its own box only; on `#world` the
  tooltip carries `data-pass` (`pointer-events: none`) so presses reach what it covers; a control that arrives under a
  resting pointer (a re-render: the pressed swatch rebuilt, a palette that shifts as a choice saves, a card's buttons
  moving as its Vote count appears) opens nothing until the pointer moves, as native titles behave. The browser
  reports such a control as entered (`pointerover`) with no `pointermove`, at the pointer's last position, so one
  passive `pointermove` listener keeps that position (two numbers per move). A pressed control rebuilt that way hands
  its press to its replacement.
- Focus returning to a control after its popup closed doesn't reopen its hint: the tooltip cancels a `trigger-focus`
  open within 400 ms of a popup closing (`popupJustClosed()`; code that returns focus after closing something that is
  not an SDK popup calls `notePopupClosed()`).

**Look.** `.tk-tip` (`ui-sdk.css`): an ink face like the toast (`data-height="float"`, rim set to the face), 12 px
text, `--shape-cell` corners, no arrow, a 120 ms fade that `data-instant` skips. Placement is the SDK's (top, flipping
and shifting, `collision-padding="8"`).

### Collections

A collection with no shipped element to wrap is built from Core helpers in one primitive and rendered with
`createParts` around markup we already draw. `ui-listbox` options would replace our cards, and its plain click toggles
where ours opens. Two exist: Home's board grid (`home-board-list.js`) and the Comparison order (`order-list.js`).

1. **One primitive, two slots.** `definePrimitive({name, options, controlled: ['value'], state, sync, api, slots})`.
   `api` composes `createRovingFocus` (one Tab stop; `move` for the layout), and as needed `createSelection` (the
   anchor), `createTypeahead`, `createFocusRecovery`, `createReorder`. The `root` slot declares the role (`listbox`),
   its `keys`, and handles `keydown`. The item slot declares `role: 'option'`, `focus: 'roving'`, writes
   `aria-selected` and the roving `tabindex` in `attrs`, and binds roving focus (and recovery or reorder) in `bind`.
   Roles go on the slot, never in `attrs` (core.md § Roles).
2. **Thin wrappers.** `createParts(primitive, {root: {tag, display, api: [...]}, item: {tag, display: 'contents',
   target: el => el.querySelector('.our-focusable')}})`. The item part binds the element that should own focus and
   keys (the card's own link), so the focus ring, Enter and a plain click stay native. `display: contents` wrappers
   leave the layout to our markup.
3. **Controlled value.** Our code owns the value. It sets `root.value = [...]` (no event) after every change of its own
   (marquee, clear, re-render), and listens for `valuechange` (on the root, non-bubbling) to take the changes the
   primitive asks for from keys and presses. Pointer gestures the primitive doesn't map (modifier clicks, the select
   circle) call methods the root exposes (`api` in `createParts`), so the anchor stays the primitive's.
4. **Re-rendering.** `reconcileChildren` keeps an element bound when its key matches. An element carrying `data-slot`
   that our fresh markup doesn't write keeps every attribute our markup doesn't mention (role, tabindex,
   aria-selected, data-slot). So never write a part-managed attribute in render markup; write only what is ours.
5. **Wrappers in markup.** Render the root every time, empty or not, so the instance and its Tab stop survive live
   updates. Anything that isn't an item (an empty-state line, a "New" card) sits beside the root, so the role's
   children stay options. A wrapper never repeats an attribute of the element it wraps: an item wrapper needs its own
   re-render key (`fr-board[data-home-entry]`, a key `reconcileChildren` knows), or every `[data-home-board=id]` query
   finds two elements.

Home's grid: `fr-board-list[aria-label=Boards]` (role `listbox`, `aria-multiselectable`) > `fr-board[value=itemId]` >
`article.board-card[role=none]` > `a.board-link` (role `option`). Keys and pointer: § 4, Home board grid. The
Comparison order adds `createReorder` with the SDK's pick-up keys: § 4, Comparison order.

### Board canvas

Files: `board-focus.js` (`BoardFocus` and pure helpers covered by `tests/board-focus.test.mjs`), `workspace-board.js`
(the board's key handler and Escape ladder, `queueableKey`, `translateOccurrences`, `keyMoveRunning`, `pressFocus`,
`focusedTarget`, the `focusin` bookkeeping, card markup through `boardFocus.cardMarkup`, `rovingMarkup`),
`whiteboard.js` (drawn elements' markup through `boardFocus.decorationMarkup`, the keyboard resize corner, Enter on a
container, announcements for arrow ends and sticker turns), `canvas.js` (`revealBox`, `+`/`−`/`0`, the step's focus,
focus back after the reader), `board-step.js`, `calm.css` (focus rings), `pointer-focus.js`. Core helpers come from
`vendor/ui-sdk/web/core.js` through a dynamic import (`sdkCore()`), so the board's start never waits for it:
`nearestInDirection`, `announce`, `keepFocus`, `moveMessage`, `resizeMessage`, `reorderMessage`. `announce()` in
`board-focus.js` queues a message until Core is in.

**Built on the board's own engine, not a primitive.** The SDK's canvas norms (core.md spatial focus, `createReorder`,
`createMove` and `createResize` keys, announcements, viewport keys) are implemented on top of the board's own pan,
drag, resize and marquee. `createRovingFocus`/`spatialMove`, `createMove`, `createResize`, `createReorder` and
`createViewport` are context helpers that need a primitive with a part around every card, which would put SDK
elements on the paths that must stay cheap (§ 6). Everything here runs on key, focus and press events; nothing runs
per card on wheel, pointer pan, drag or marquee, and no observer is added. A later move to a primitive would replace
`BoardFocus` with `createRovingFocus({move: spatialMove({rect})})` (the rect is `items()`'s board-unit boxes),
`moveKey` with `createMove({step: 1, group})`, `resizeKey` with `createResize`, `reorder` with `createReorder`, and
`revealBox` with `viewport.reveal`.

- **One Tab stop for the board's items.** Cards and every drawn element (text, shapes, regions, arrows, stickers,
  containers) are one roving group. The item focused last (`boardFocus.stop`, a key such as `placement:<id>` or
  `decoration:<id>`) has `tabindex=0`; every other item has `-1`. The stop is written into the render markup (so
  `reconcileChildren` never fights it) and moved in place on `focusin` (`setStop`: two elements' attributes). Before
  anything is focused, the first card on the board itself (not inside a container) holds it, else the first drawn
  element there. If the focused item goes away in a rebuild, focus goes to the item nearest where it was
  (`lostBox`/`ensureStop`, the SDK's focus-recovery idea): a removed card, and a deleted drawn element (Delete, or
  ⌘D then Delete on the copy, which lands on the original). Both measure on screen, because a deleted drawn element
  has already left the snapshot the rebuild draws (a removed card stays in it, marked removed).
- **Controls inside an item.** The stop item's own controls follow it in Tab order: select circle, ⋯, title, resize
  corner, hover-strip buttons, version ticker; a Text block's task boxes, links and overflowing label (Chrome makes
  a scroller a Tab stop); a selected sticker's rotate and resize handles. Inside every other item they carry
  `tabindex=-1`. The preview's big "Open" never takes a Tab stop (it duplicates the title and the strip's Open).
- **Toolbars inside an item.** The hover strip (Open | Edit | Comments | Vote | Favorite) and a stack's ‹ name ›
  ticker are `role=toolbar` with `data-roving`, not `ui-toolbar` (that is an element and a binding per card).
  `rovingMarkup()` writes `tabindex=-1` on every control but the first enabled one. One capture `keydown` listener for
  the page (`BoardFocus.roveKey`, registered before the board's handlers) moves focus: ←/→ wrap, Home/End; ↓ on a
  button with `aria-haspopup` clicks it (Vote opens its ballot; the version name's ↓ is `menuKey`'s). The `focusin`
  bookkeeping gives the focused control the stop and remembers it per toolbar class for the stop item (`rove`); a
  rebuild re-asserts it (`restoreRoving`, only when something was remembered); focus arriving on an item hands the
  stop on if a narrow card hides the first control (`roveReach`, one item, on focus). Hidden controls are skipped;
  `aria-disabled` ones (‹ › at either end) stay reachable. `setStop` leaves a toolbar's non-stop controls at `-1`.
- **Arrows move focus, not things.** Plain arrows (Shift too) on a focused item move focus to the nearest item that
  way: `nearestInDirection` on board units from the board's data (no layout read; Grid layout uses screen boxes), so
  zoom never matters and Left is always screen-left. The view pans just enough to bring it in, in one step, clear of
  the floating footer (`revealBox`). Home / End go to the first card / the last item (cards first in reading order,
  then drawn elements). A held arrow keeps moving. Arrows pressed on a control inside an item stay with it (they pan,
  or scroll an overflowing Text block).
- **Tab onto an item brings it into view** the same way (`revealElement`, from the `focusin` bookkeeping, only when a
  Tab moved focus): the browser's own focus scrolling (carried over from the cushion as a pan) skips an item it shows in
  part. A press, and focus coming back after the reader or a menu, never move the board. `revealBox` first takes any
  cushion scroll the browser already made, so the two never add up.
- **Containers are composite items.** Outside, a container is one item and the arrows pass over its members (they
  move among items with the same container, `scope()`). **Enter** goes in, to the member focused last there (the
  SDK's `remember: true`), else its first, and announces "Stack: 3 items. One. Escape returns to the container."
  Inside, arrows move among its members and stop at its edges; Home / End reach its first / last member in the
  container's order. **Escape** comes back out to the container, as the last step of the board's Escape ladder. An
  empty container has nothing to enter, so its Enter keeps Whiteboard's meaning (its options). F2 still edits the
  container's title.
- **Focus is not selection.** Space toggles the focused item's selection, as ⌘/Ctrl-click does
  (`toggleOccurrence`), and focus stays; a grouped item brings its group ("Group of 2 selected. 2 selected.").
  Enter opens the focused card; with focus off the items, Enter opens the one selected card. A drawn element's Enter
  and F2 stay Whiteboard's (options, edit text). Focus ring: an ink ring outside the blue selection line, following
  the card's squircle and clear of a version stack's sheets (`--under-d`), so a focused selected item shows both;
  drawn elements get the same ring, square.
- **Commands with nothing selected act on the focused item** (`focusedTarget()`, `adoptFocusedTarget()`): ⌘I opens its
  Details (focus comes back to the card), ⌘D duplicates it, E edits a focused Markdown document, `]` / `[` restack
  it: the keys the card's menu prints act on what the menu belongs to. Duplicate and restack first make the focused
  item the selection, as opening its menu does. With a selection they act on the selection. **Delete is the
  exception**: it removes only what is selected (a slip costs work, and the menu prints no Delete key); on an
  unselected focused item it removes nothing and says "Nothing is selected. Press Space to select <item>, then
  Delete." (live region and toast).
- **Option/Alt + arrow moves** (`moveKey`), 1 unit, 10 with Shift (`createMove`'s keys and steps). A focused item that
  is selected carries the selection (and a mixed group's drawn elements); a grouped one that is not selected carries
  its group, as dragging does; one that is neither moves alone; with no item focused, the selection moves. A
  container moves with its contents. One write and one undo step per press, announced with `moveMessage` ("A2 moved
  to 299, 0.").
- **Option/Alt + arrow on a container member reorders it** (`reorder`, `reorderIndex`): one place along the
  container's layout (a stack along ↑/↓, a row along ←/→, a grid ←/→ one place and ↑/↓ a row), with Shift to the
  first or last place. One `moveContainerMember` write, one undo step, focus stays, announced with `reorderMessage`
  ("Dropped Three at position 2 of 3."). An arrow across the layout moves nothing and says where the member is. The
  SDK's reorder picks up with Space; on the board Space selects, so the move chord does it in one press.
- **Resize corners.** A card's corner is a button named "Resize bottom right of <title>". A selected shape, Text block
  or sticker has one too: its bottom-right handle is a focusable `role=button` named the same way (the other seven
  stay pointer-only). Arrows move that corner, 1 unit, 10 with Shift (`createResize`'s keys), within the minimum
  size; a sticker keeps its proportions; an auto-height Text block becomes fixed, as a drag makes it. Announced with
  `resizeMessage`. Arrow ends, an arrow's bend and a sticker's rotation have keys and are announced ("Arrow end moved
  to 420, 310.", "Sticker rotated to 15°.").
- **Writes queue instead of racing.** A drawn object's save holds Undo, Redo and Paste busy until its refresh has
  landed (`decorationCommitting`, a setter that updates them), as the board's command keys already wait for it
  (`keysBusy`): before, they read idle while the saved board was still being fetched, so a gesture begun then (a card
  resize after moving an arrow's end) drew from the board before the save, and the arrow jumped to its old side. A
  keyboard move, reorder or resize holds the board busy until its write and refresh land (`keyMoveRunning`); meanwhile the key queue (`installKeyQueue`, window capture) holds Option-arrows and
  arrows on a resize corner and replays them in order. Plain arrows, and Space / Enter on a focused item or on a
  button or link, are never queued (`queueableKey`): a replay would land on whatever has focus by then, or swallow a
  button's native press. Escape clears the queue.
- **Focus follows a press** (`pressFocus`). A press on any board item (card, drawn element, sticker, container member)
  makes it the focused item, so Option-arrow, Space and the board's commands act on what was pressed. A card takes
  focus natively, but Whiteboard's pointerdown prevents that for drawn elements and stops the event on document
  capture (a group drag can stop it on window capture), so `pressFocus` listens on window capture, registered before
  Whiteboard mounts, and focuses the item by its key a frame later (the press's own selection may re-render it). Focus
  that moved on within that frame (code acting on the press, a click an assistive technology sends in one go, a key
  pressed straight after) is left where it went: only focus still where it was (the same element, or the same board
  item re-rendered), or dropped to `<body>`, is moved. A press on empty canvas, or on a plain region's open middle,
  focuses the canvas, from wherever focus was (Add, Find, a panel's comment field): the canvas is a focusable place,
  and a press on one takes focus. Only a field on the board itself (an editor the press finishes) keeps it. A press on a control inside a card keeps native focus there, and a button inside the pressed drawn element that took focus within that frame (an arrow's end handle focused straight after the press that selected the arrow) keeps it: moving focus to the arrow would hand Delete to the whole arrow instead of detaching the end. Pointer focus draws no ring
  (`pointer-focus.js` marks it `data-pointer-focus`), except that the return pulse still shows. Checked in
  `tests/board-fixes-browser.mjs` and `tests/canvas-keyboard-browser.mjs`.
- **Focus follows what the app creates** (`focusCreated`). What the app creates and selects takes focus (the first of
  it): Duplicate (⌘D, the card menu, the Inspector), Paste, imported files, an Option-drag copy, an arrow drawn from a
  port, a new document's card (under its editor, so closing the editor comes back to it: `finish` in
  `board-document.js` focuses the card as the frame goes inert, and again after the save's refresh, unless a press
  outside ended the edit and took focus elsewhere; the same for E on a document). So Option-arrow moves the
  copy, never the original, as in Figma, tldraw and Excalidraw. Add's Text, shape, arrow and sticker focus what they
  make. Focus in a field, an editor or a modal dialog stays. Quick jot is the exception: a jot is not selected, and
  focus stays in its field for the next line. Checked in `tests/board-fixes-browser.mjs`.
- **Comment pins are one Tab stop** (`comment-pins.js`), after the board's items and like them: the pin focused last
  holds it (else the first in reading order), arrows move to the nearest pin that way (`nearestInDirection` on screen
  boxes), Home / End reach the first and last, Enter or Space opens the focused pin (a cluster opens its list), and
  Escape from its card comes back to it. The layer is a `role=group` named "Comments: N open". Checked in
  `tests/comment-pins-browser.mjs`.
- **Focus comes back.** Closing the reader returns focus to the card last viewed when it was opened from the board's
  items (§ Opened item). Escape in the selection bar clears it and sends focus to the board's roving item, else the
  first card, else the canvas (`afterBar`).
- **Zoom keys.** `+`/`=`, `−` and `0` (100%, position kept about the centre) with the canvas or an item focused,
  announced in `#view-announce` ("Zoom 115%"). Arrows, Page keys and Space still pan when the canvas itself has focus.
- **Marquee announcement.** The marquee is the board's own (§ 5); the selection count is announced on release.
- The canvas's `aria-label`, the help text and the Keyboard shortcuts sheet (`keyboardShortcuts()` in
  `workspace-board.js`) describe all of this. Keep them in step with any change.

### Inspectors (side panels)

The board, item and reader Inspectors are non-modal `ui-dialog`s, through `sidePanel()` (`side-panel.js`). An
Inspector is a working panel beside the board, like the Navigator: the board stays usable around it. Not modal; not a
Popover (it hangs off its trigger and closes when focus leaves); not a Drawer (a modal sheet with a drag handle).

```html
<ui-dialog id="board-info-dialog"><ui-dialog-content id="board-info" inline class="calm-side …" hidden
  aria-labelledby="…">…</ui-dialog-content></ui-dialog>
```

```js
const panel = sidePanel(root, {openers: () => [toggle], keepOpen: target => …, body: c => c.querySelector('.body'),
  onClosed: reason => …});
panel.open({opener: toggle});      // or {opener: '#selector'}, {focus: false}, {focus: element}
panel.close(); panel.toggle(options); panel.isOpen; panel.hadFocus;
```

- `sidePanel` sets `modal="false"` and `close-on-outside-press`. `inline` keeps the panel's fixed place and stacking
  (no top layer). The SDK writes `role="dialog"`; name the panel by its heading or `aria-label`.
- **Focus on open**: the first control of the panel's body (marked `[data-initial-focus]` and set as `initial-focus`),
  not the header's × (the SDK's first focusable). `focus: element` starts there; `focus: false` moves nothing
  (`initial-focus="none"`).
- **Escape** closes it while focus is inside; focus goes to `final-focus` (the opener's id or the selector), or, when
  a shortcut opened it (⌘I), to whatever had focus. With focus elsewhere, the board's and the reader's Escape ladders
  close an open Inspector in their turn (focus stays put). Escape on an open Inspector's toggle closes it.
- **Tab** leaves the panel and it stays open (popups.md § Focus: "A non-modal dialog stays open"), and goes on through
  the page and off it. The board Inspector sits in the header right after its toggle: toggle (in the top bar's
  toolbar) → panel → the board. The item Inspector and the Comments panel sit right after the board and its
  drawn-object bar (`placeInBoardOrder` in `popups.js`, as the bar does): the board's items and pins → panel → kind
  legend, zoom pill, tools rail → off the page, and Shift+Tab back the same way. At the end of `<body>` they had to hand
  Tab back to their opener, and Tab past the tools rail then came round into them again, a loop only Shift+Tab left; a
  panel placed in order carries `data-in-order`, and the popovers' Tab-out rule leaves it alone. Inside the reader, the
  Comments panel sits at the end of the reader's area and keeps that rule (`tabOutOfPanel` with its opener). The item
  Inspector's `content.tabTrigger` still names its opener (the control that opened it while on screen, else the card's
  ⋯, else the card), for an outside press on nothing focusable. Checked in `tests/last-fixes-browser.mjs`.
- **Outside press** closes it, except a press on one of its `openers` (they toggle), a press that began inside the
  panel (even if its target re-rendered away), a press on a detached node, and whatever `keepOpen(target)` accepts
  (modal dialogs, menus, the feedback panel, the vote ballot). A press into an iframe is not seen by the page.
- **A dialog opened from an Inspector opens over it**, and the Inspector stays open behind (the dialog's press and
  focus never count as leaving it): Keyboard shortcuts… (board and reader Inspectors), Edit item… (item Inspector),
  Edit details… (reader Inspector), Comparison order…. Closing the dialog returns focus to the button that opened it,
  so the next Escape closes the Inspector and returns to its toggle. After Edit item… saves, the item Inspector is
  rebuilt in place at once (`itemControls(id, "edit", {again})`: no slide-in, the same return target), focus on Edit
  item…; the reader Inspector re-renders, and its Edit details… is found again by an `opener` function.
- Code that only knows the panel element closes it with `closePanel(content)`. Never write `hidden` on a panel the SDK
  owns (its state would not follow); reading `.hidden` is fine.
- The item Inspector starts where its opener asks (Notes, the actions, Appearance). Opened from a menu item that has
  gone, it returns focus to the card's ⋯, else the card. Its element is removed a frame after it closes, once the SDK
  has returned focus; its id goes at once, so a new one never shares it.

### Opened item (the reader)

Files: `reader-dialog.js`, `canvas.js` (`openReader`, `closeReader`, `focusBoardItem`, `handleEscape`,
`closeFramePopup`, `updateReaderNavigation`, `readerTinkaFocus`), `board.html`, `reader.css`.

**Still the browser's modal `<dialog>`, behaving as the SDK's modal Dialog.** `showModal()` already gives the top
layer, an inert page hidden from assistive technology, and `aria-modal`. Swapping it for `ui-dialog-content` would
change every `dialog[open]` check across the app and about 90 test selectors in 24 files, on lines upstream also
edits. What the browser leaves out is added:

- **Focus on open**: Tinka's canvas (`#reader-stage`), so its keys work at once.
- **Tab wraps** (`trapTab(dialog)`, dialog.md § Modal): from the last stop to the first and back. Containers inside
  that keep their own Tab (`OWN_TAB`: a nested modal dialog, menu, popover, select, listbox) are skipped.
  `tabStops(root)` lists the stops; `side-panel.js` reuses it.
- **Escape, one layer at a time.** An open SDK popup inside the reader (menu, popover, tooltip, nested dialog, an
  Inspector with focus inside) takes its own Escape first (`inPopup` in the document Escape handler). Then
  `handleEscape` peels: the feedback panel → the reader Inspector → the Navigator → the notes column (if focus is in
  it) → a popup still open inside the content frame (`closeFramePopup`, same-origin frames, up to three deep) → closes
  the reader. Escape during IME composition does nothing. A frame's own SDK popup with focus inside takes its Escape in
  the frame (the SDK calls `preventDefault`), so `media.js` and `item-content.js` never post `reader-close` for it.
- **Focus goes back** (popups.md § Focus). Opened from a card on the board, focus returns to the card last viewed
  (after any stepping) without moving the board: `graph.focusPlacement`, or the card's Open control. A card's menu
  (⋯, right-click, Shift+F10, "Open") counts as the card (`openReader`): its item has left the page by the time the
  reader closes, and the canvas would be the fallback. Opened from
  anything else, `rememberOpener()` / `openerToReturnTo()` return focus to that control while it is still on the page
  and focusable, else to the canvas.
- **Stepper: `ui-pagination`** (`#reader-stepper`, "Step through <board>"; role `navigation`, a list inside). ‹ and ›
  are its Previous and Next parts; the `n / N` count between them stays our button (it opens the path). `pageCount`
  and `page` are set from the stepping sequence (property writes) and `pagechange` is cancelled: our own click
  handlers step. At either end the step keeps focus and is `aria-disabled` / `data-disabled` instead of natively
  disabled (pagination.md: "Pressing Next onto the last page keeps focus on Next"); the dimmed look keys on
  `aria-disabled`.
- **Tab order**: header (navigation, then the actions toolbar) → version switcher (`#reader-file-versions` sits between
  header and stage in the DOM) → Inspector (when open) → content → zoom pill → notes column.
- The reader's announcer is `#reader-view-announce`, inside the dialog (the board's is inert behind the modal).

## 3. Keys

### Who owns a key

Board-level key handlers listen in the capture phase on `window` or `document`, so they run before the SDK's own
handlers on the focused element. They must step aside for a widget that owns the key.

| Check | Where | True when |
|---|---|---|
| `widgetOwnsKey(event)` | `ui-sdk.js` | Escape with a tooltip open; focus inside `[role=menu]`, `menubar`, `listbox`, `tree`, `grid`, `combobox`, `dialog`, `alertdialog` or any open SDK content (`[data-slot$="-content"][data-open]`), for every key; focus inside `[role=toolbar]`, `radiogroup`, `tablist`, `slider`, `spinbutton` or `[data-slot=resizable-handle]`, for the navigation keys (arrows, Home, End, PageUp, PageDown, Enter, Space). Letters and Escape still reach the board from a toolbar. |
| `inPopup(event, {tooltips})` | `popups.js` | Escape with a tooltip open (unless `tooltips: false`); the target is inside open SDK popup content other than a tooltip; or the target is the trigger of a popup that has just opened (`aria-expanded="true"` + `aria-controls` naming open content), which covers a key pressed in the frame before focus moves in and an open Inspector's toggle. Narrower than `widgetOwnsKey`: it lets handlers keep their keys inside non-popup dialogs. |
| `sdkPopupOpen()` | `ui-sdk.js` | Any SDK popup other than a tooltip is open anywhere on the page. |
| `menuOpen()` | `popups.js` | A `ui-menu-content` is open. For `window` capture pointer handlers. |
| `boardCommandBlocked(event)` | `workspace-board.js` | Clipboard blocked (busy, editing, a field or `role=dialog` focused, an iframe focused, a modal open), history busy, the target is a field or `role=textbox`/`dialog`, `widgetOwnsKey`, or a keydown `inPopup`. Guards every board command. |
| `MODAL_OPEN` | `workspace-board.js` | A modal `<dialog>`, SDK modal dialog or alert dialog is open. |

### The board's key handler order

The board's item handler (`workspace-board.js`, document capture keydown) runs in this order and stops at the first
step that takes the key:

1. The reader or a workspace dialog is open: return.
2. Focus is in the board map (`.board-map`): return (the map owns its keys).
3. `inPopup(e)`: return (an open menu, popover or Inspector panel owns every key, Escape included).
4. IME composition or `defaultPrevented`: return.
5. A repeat: plain arrows keep moving focus (`boardFocus.repeatKey`) unless `widgetOwnsKey`; nothing else repeats.
6. `menuKey`: Shift+F10 / the context-menu key opens the card or board menu; ↓/↑ on a ⋯ or a version name opens its
   menu; ↓ on a menu button inside a toolbar is left to `openOnArrowDown`.
7. The feedback panel's Escape (`feedback.consumeEscape`), then Whiteboard's (`whiteboard.handleEscape`).
8. The Escape ladder: the item Inspector (`closeContext`) → the drawn-element selection → the card selection (from the
   selection bar, focus goes to `afterBar`) → out of a container (`boardFocus.escapeKey`, skipped while a cut is
   pending).
9. `widgetOwnsKey(e)`: return. (Escape was handled above first because the item Inspector is `role=dialog`.)
10. A field, `role=textbox` or `role=dialog` target, or ⌘/Ctrl held: return.
11. `boardFocus.keydown`: arrows / Home / End move focus, Space selects, Enter opens or goes in, arrows on a card's
    resize corner resize, Option/Alt + arrow moves or reorders.
12. Option/Alt held: return.
13. Delete / Backspace: removes the selection, or explains how (§ Board canvas).

Other capture handlers on the board page, each checking the same predicates: the board commands
(`installBoardCommands`: `inPopup` first, then `boardCommandBlocked`), ⌘Z, ⌘D, the step keys (`canvas.js`), ⌘I, the
cut's Escape, the pan tool's and comment layer's Escapes, the key queue (`queueableKey`), the toolbars inside cards
(`roveKey`, registered first), and the tooltip delegate's Escape.

### Escape, one layer at a time

1. A tooltip showing: only the tooltip closes (`widgetOwnsKey` and `inPopup` both yield).
2. Open tile notes close, focus back to their opener (`canvas.js` document Escape handler, which runs 2–5 in order).
3. Escape on an open Inspector's toggle closes that Inspector.
4. An open SDK popup with focus inside, or its just-opened trigger: the popup's layer closes and focus returns.
5. In the reader: `handleEscape` (§ Opened item).
6. On the board: the item handler's ladder (steps 7–8 above); an open board Inspector closes (`canvas.js`).

### Shortcut map

Board (the Keyboard shortcuts sheet, `keyboardShortcuts()`; handlers in `workspace-board.js` unless noted):

| Keys | Action |
|---|---|
| Tab, then arrows | Reach the board's items; arrows move to the nearest item that way; Home / End first / last |
| Space | Select or deselect the focused item (a grouped item brings its group) |
| Enter | Open the focused card, or the one selected; on a container, go in |
| Escape | Close the newest panel or menu, then cancel a gesture, pending Cut or selection; on a container member, back out |
| ⌥ / Alt + arrow, + Shift | Move the focused item (and its selection or group) 1 / 10 units; on a container member, one place / to an end |
| Arrows on a resize corner | Resize 1 unit, 10 with Shift |
| J / K | Select the next / previous Tinka in the stepper's order and bring it into view (`board-step.js`, `canvas.js`); with nothing selected, from the focused card |
| Ctrl + ← / → (not on a Mac) | Same as J / K |
| ] / [ | Bring the selection (or focused item) to the front / send it to the back |
| ⌘/Ctrl A, D, G | Select all; duplicate (nothing selected: the focused item); group / ungroup (only when there is something to group) |
| ⌘/Ctrl I | Inspector for the selected Tinka (nothing selected: the focused one) or the board (`canvas.js`) |
| ⌘/Ctrl K or / | Navigator |
| ⌘/Ctrl Z, Shift ⌘/Ctrl Z | Undo, Redo |
| ⌘/Ctrl C, X, V; Shift ⌘/Ctrl C | Copy, Cut, Paste; copy the board's notes as Markdown |
| Delete / Backspace | Remove the selection (only what is selected) |
| F; hold F or Z through a selection box | Fit the selection, then the board; fit what the box selected / zoom to the box |
| ⇧1, ⇧2, ⇧0 | Fit the canvas, fit the selection, 100% |
| + / =, −, 0 | Zoom in, out, 100% (canvas or an item focused; `canvas.js`) |
| M, A, V, H | Board map, edit tools, Pointer, Pan |
| T, S, D | Add Text, a Sticky note, a Markdown Document at the pointer |
| E | Edit the selected (or focused) Markdown document |
| C, ⇧C | Comment tool (Enter or Space on a focused item drops the pin), show or hide comments |
| N | Quick jot |
| ? | Keyboard shortcuts |
| Shift+F10, context-menu key | Card menu on a focused card; board menu on the focused canvas |
| ⌥ / Alt + F10 | The drawn-object bar, from anywhere outside a field (`whiteboard.js` `focusBarKey`); Escape on the bar returns to its object |
| ⌥-drag | Place a copy (a pointer chord; never meets ⌥ + arrow) |

Plain letters fire only on the board, never in a field, and inside a menu they are its typeahead.

Opened item (`reader-keys.js` `readerCommand`, `canvas.js`):

| Keys | Action |
|---|---|
| ⌥ ← / → (Ctrl elsewhere), [ / ], K / J | Previous / next Tinka |
| Plain ← / → | Previous / next, while focus is on Tinka's own chrome or canvas (`readerTinkaFocus`; not in a toolbar, toggle group, segmented control, the Navigator, the Inspector or the notes) and all of the Tinka is in view |
| Plain arrows, Shift + arrows | Pan, while zoomed in past fit (part of the Tinka out of view, `ReaderCanvas.overflows`): 80 px a press, a screenful (87.5% of the stage) with Shift; held, they keep panning. They never step while zoomed, not even at an edge |
| ⌥ ↑ (Ctrl elsewhere), Escape | Up to the board (Escape after the ladder) |
| ⌥ ↓ (Ctrl elsewhere) | Down into the Tinka's own board |
| F, ⇧1; 0, ⇧0; + / − | Fit; 100%; zoom (announced in `#reader-view-announce`) |
| ⌘/Ctrl I | Toggle the Inspector |
| Space-drag | Pan a magnified resource with the pointer |
| ? | Shortcuts |

Same-origin content forwards the step, up and down chords. Text fields keep every one of these keys. The controls
declare them per platform: Up `Escape Alt+ArrowUp`, Previous `Alt+ArrowLeft [ K`, Next `Alt+ArrowRight ] J` (Control
in place of Alt off a Mac).

Home, Navigator, popups and lists: § 4 entries (Home board grid, Navigator, Sticker picker, Comparison order). Every
menu: typeahead, wrap, Home/End, Escape one layer, focus in on open and back on close, Tab closes it and moves on from
the opener. Every popover: Tab walks its controls and out to the trigger's next control, arrows belong to the focused
control.

### Decisions that differ from upstream Tinka's keys

- **Plain arrows move focus; ⌥ + arrow moves the object.** Upstream 1.3 nudged the selection with plain arrows. The SDK's
  canvas norm (Option/Alt with an arrow moves; `createMove`) took the chord.
- **`]` / `[` are Bring to front / Send to back on a board** (upstream 1.4, as in drawing tools such as tldraw and
  Excalidraw).
- **J / K step on a board.** With ⌥ ← / → moving and `]` / `[` stacking, stepping took J (next) and K (previous), the
  list-review keys of Gmail, GitHub, Feedly and Reddit: either case, never with Shift or a modifier, never in a field,
  never while a menu has focus. Inside an opened Tinka nothing stacks, so `[` / `]` and ⌥ ← / → still step there, and
  J / K too. A step with focus on the board takes focus to the stepped card.
- **Delete removes only the selection**, never a merely focused item.
- **⇧-click toggles on the canvas** (a 2-D board has no order for a range); on Home's grid it selects a range.
- **⌘G groups only when there is something to group**, else the browser's Find Next stays.
- **Containers reorder with the move chord in one press**; the Comparison order uses the SDK's pick-up model and also
  answers the chord (§ 4).

### Adding a shortcut

1. Pick a key no widget owns. Don't take arrows, Home/End, Enter or Space on a focused item, ⌥ + arrow (move), Space on
   the board (select), or a plain letter that a menu would use as typeahead while it has focus.
2. A board-level handler listens in the capture phase and checks, in order: `inPopup(event)`; for a board command,
   `boardCommandBlocked(event)` (which includes `widgetOwnsKey`); otherwise `widgetOwnsKey(event)`, fields
   (`input,textarea,select,[contenteditable],[role=textbox],[role=dialog]`) and `MODAL_OPEN`. Handlers on `window`
   capture that react to presses check `menuOpen()`.
3. Plain letters: never with a modifier, never in a field, only on the board. Use `matchesShortcut(event, 'mod+x')`
   from Core for ⌘ on Apple platforms and Ctrl elsewhere.
4. If the command writes, decide whether `queueableKey` should hold it while the board is busy.
5. Declare it: `aria-keyshortcuts` on the control, both platforms where they differ (`Meta+K Control+K`); on a menu row
   with `menuItem(…, {shortcut})`. The tooltip and keycaps then show it.
6. Add it to the Keyboard shortcuts sheet and, where relevant, the canvas's `aria-label` and help text.

## 4. Surfaces

Each entry: files, SDK parts, and what is not obvious. Everything not said follows § 2.

**Home board grid.** `home-board-list.js` (the primitive), `workspace-home.js` (render, pointer gestures, the bar),
`reconcile.js`. Core: `definePrimitive`, `createParts`, `createChange`, `createRovingFocus`, `createSelection`,
`createTypeahead`, `createFocusRecovery`, `isTypeaheadKey`, `matchesShortcut`. Applies to the organized Home
(`WorkspaceHome`); the legacy shelf in `home.js` is not on it.
- Each option is named by its board title (`aria-labelledby`) and described by its description and dates. The select
  circle is `tabindex=-1 aria-hidden=true`: a pointer affordance; the option carries the state.
- Keys: Tab enters once, on the board focused last (before that the first selected, else the first). Arrows follow
  the grid as the window lays it out: Left/Right in reading order, wrapping at row ends; Up/Down by column, measured
  on the key press; Down from a column with nothing below goes to the last board; no wrap past either end. Home/End
  and Ctrl/⌘+Home/End go to the first/last board. Typing finds a board by title (the SDK's 500 ms runs). Space
  toggles, Shift+Space selects the range; Shift+arrows and Shift+Home/End extend from the anchor; plain moves carry the
  anchor along (core.md § Ranges and Select All). ⌘A selects all and again clears (also with focus outside the grid,
  not in a field). Enter opens (native link). Escape clears (not in a field). `/` goes to find.
- Pointer: a click opens the board; ⌘/Ctrl-click (and macOS Ctrl-click's context menu) toggle one; Shift-click selects
  the range from the anchor in grid order (with no anchor it starts there); the circle toggles. A press moves focus to
  its board without scrolling.
- Not `ui-listbox`: its arrows wrap and its plain click toggles in multiple mode. Escape clearing the selection is the
  app's (the SDK's selection helper maps no Escape).

**Home toolbars.** `workspace-home.js`. The Favorites/Archive row (`.workspace-home-toolbar`) and the floating selection
bar are `ui-toolbar`s of `ui-toolbar-button`s. The bar is built once on the first selection and updated in place
(count, Archive/Restore label), so a focused action keeps focus; `followVisibility` keeps it out of the Tab order while
hidden. Its Clear button has `data-tip` and `aria-keyshortcuts="Escape"`.

**Home Find.** `home.js`. `/` focuses it. Escape clears its text, and a second Escape leaves the field: focus goes back
to where it was before Find (a click or Tab there), else to the boards' one Tab stop, never to `<body>`.

**Home sort and Appearance.** `home.js`/`home.html` (Sort: segmented control), `appearance.js`. Appearance is a
`ui-menu-trigger` menu of two radio groups, Mode and Background; radio items stay open; Background items are disabled
(focusable, inert, with a hint) while the page is dark. An overview capture's forced appearance
(`?overview&appearance=…`) is not saved, and the menu shows the stored choice.

**Navigator** (⌘K, `/`, the header toggle, Find boards and items, the reader's toggle). `navigator.js`,
`navigator.css`; openers in `canvas.js` (`#chrome-search`, `#reader-search`, `#reader-navigator` pass themselves as the
opener; `tinka:navigator-open` takes `detail.opener`). Dialog, Command, Tree, Select.
- Panel: `ui-dialog modal="false" close-on-outside-press`, content `#project-navigator` with `inline` (keeps its place,
  z-index and float look). Opened from code; focus to the field (`initial-focus`, or `none` when the docked panel opens
  on page load), back to the opener on close (`final-focus="#id"`, else the SDK's rule). Escape closes only while focus
  is inside; Tab can leave and it stays open. Docked ("Keep open"): `dismissible="false"`, so Escape and click-away are
  refused, and the `dismissattempt` for Escape moves focus to the toggle. A press on a toggle or Find button is not a
  click-away (its `outside-press` is cancelled; its own click toggles or focuses the field). Close also un-docks. The
  slide-in animation is finished on close.
- The field's keycap prints Find's shortcut as the header's keycaps do (`capLabel` with `isMacPlatform`): ⌘K on Apple
  platforms, Ctrl+K elsewhere.
- Field and results: `ui-command filter="false"`. The server filters: the query goes to `/api/search` after 150 ms,
  stale requests aborted, previous results kept until the next arrive (status line and `status="loading"` say
  "Searching…"). The caret never leaves the field: arrows move the highlight (`aria-activedescendant`), Home/End move
  the caret, Enter runs the highlighted result (or, typed before results arrive, the first fresh one), Escape empties
  the field and then closes. Each result is a `ui-command-group` (title, kind, description as its label) holding one
  `ui-command-item as-child` link per place it can open. Links navigate through the panel's click handler (`follow()`,
  which saves feedback first); the SDK's Enter clicks the link, so both paths meet there. `command.announcement`
  returns null (our status line announces counts). Marks ignore case and accents (`fold()`); the server's matching
  (`lib/discovery.mjs`) ignores case only.
- Recent boards are command items while the field is empty: ↓ and Enter reach them from the field; the highlight shows
  only while the field has focus. Recent and result links carry `tabindex=-1`: the field is the list's one stop
  (command.md). Tab goes field → scope → trees.
- Boards and On this board: two `ui-tree`s, one Tab stop each; the section band is the root item, so → / ← open and
  close a section (its open state is saved). Boards is `mode="none"` with `current` (`aria-current="page"`); rows are
  links (`ui-tree-item-label as-child`). On this board is `mode="multiple"` and mirrors the board's selection
  (`tree.value` from `tinka:selection`); every `valuechange` is cancelled, and choosing a row (`action`) selects it on
  the board through `reveal`. Regions are branches. Both use `expand-on-press="false"` and toggle in `action`. The SDK
  manages a tree item's `style` (`--tree-level`): set nothing else inline on `ui-tree-item`. The browse container stops
  keydown from reaching the Command root around it.
- Scope: `ui-select` with a `tk-menu` list (press, drag to a choice, release; typing on the closed trigger changes the
  value). Hidden on Home.

**Top bars.** `header-toolbar.js`, `board.html` (`#chrome-actions` and the reader's `.chrome-actions` are
`ui-toolbar`), `canvas.js` (one `headerToolbar` call per bar), `workspace-board.js` (Undo/Redo through
`setItemDisabled`, inserted beside `tipOuter()` of the Inspector toggle). The left of each bar is navigation (the
Navigator toggle, home, the parent crumb, the board title; in the reader also Up, the path and the stepper): links and
places, each its own Tab stop, as the SDK's Navigation Menu keeps them. The right acts on what is shown: on a board
Find, Undo, Redo, Inspector, Add ("Board actions"); in the reader Favorite, Notes, Find, Inspector ("Tinka actions"):
one toolbar, ↓ opens Add's menu. Undo/Redo with nothing to undo and the reader's Favorite while notes load are
`aria-disabled` and stay reachable. The board title is a heading, not a field. In the reader, `[` / `]` and ⌥ ← / →
still step from the toolbar; plain ←/→ step from the stepper and the canvas.

**Board selection bar.** `workspace-board.js` `selectionMenu`: `ui-toolbar#workspace-selection`, built once and updated
in place (count, the Group/Ungroup label, Archive/Restore, which of Arrange, Edit document, Details… and the actions a
drawn group excludes show), so a focused action keeps focus. `followVisibility`. Arrange is a menu button (↓ opens it).
Escape inside it clears the selection (§ Board canvas).

**Canvas tools rail.** `workspace-board.js` `installEditTools`: `ui-toolbar#edit-tools` ("Canvas tools", a horizontal bar at the bottom of the board).
Navigation (Pointer, Pan) and Feedback (Comment) are `ui-toggle-group`s (`data-edit-choice`, `onChoose`/`setChoice`);
Draw is a `ui-toolbar-group` of buttons. The rail and map toggles are `ui-toggle` items of the view pill.

**Zoom pills and popovers.** `board.html` (`#zoom-popover`, `#reader-zoom-popover`), `canvas.js` (`setZoomMenuOpen`,
`setReaderMenuOpen`), `comment-pins.js` (the comment bar in the pill). The pills are `ui-toolbar`s; % is a
`ui-popover-trigger for=`. The popovers (sliders, the Pattern / Window / Light segmented controls, the version list)
sit outside their pills; the reader's inside the reader dialog. ↓ on % opens them (`openOnArrowDown`). The preset rows
(Zoom to 50 / 100 / 125 % or 200 %, Fit board and Fit selection, or Fit this Tinka) look like menu rows, so they are one
vertical `ui-toolbar.zoom-presets` ("Zoom presets"), as the item Inspector's actions are: one Tab stop, ↑/↓ with wrap,
Home/End, Enter or a click chooses. The slider follows the rows as its own Tab stop (on the board after Fit board, in
the reader after Fit this Tinka), so ↓ never walks onto it; its arrows change the zoom. Fit selection is hidden and out
of the toolbar's order with nothing selected (`disabled` + `focusable-when-disabled="false"` on its part, written as the
popover opens: `followVisibility` can't serve a toolbar inside a closed popover, whose items aren't rendered when the SDK
picks the first focus). Focus opens on the rows' stop; the other controls keep their own arrows, Tab walks through and
out to the next pill control; Escape and a choice return to %; an outside press closes them and reaches its target. A click
into the experiment frame closes the reader's; switching windows leaves it open. The pill's 44 px rows and slider theme
reach them by naming `.board-zoom-popover` / `.reader-zoom-popover` / `.zoom-menu` in the theme's own selectors
(`calm.css`, `canvas.css`, `ui-sdk.css`) at the same specificity. Placement matches the old `right: -40px` (`align="end"
align-offset="-40"`).

**Card menu (⋯ and right-click).** `workspace-board.js` `tileMenuElement`, `tileMenu`, `runTileMenu`, `menuKey`:
one `ui-menu#workspace-tile-menu`. ⋯ opens it under the button (right edges aligned), right-click at the pointer
(selecting the card first), Shift+F10 / the context-menu key under the focused card's ⋯; ↓/↑ on a focused ⋯ open it
at the first / last item. A second right-click re-anchors (on another card it becomes that card's menu). Focus returns
to the ⋯ when it came from the ⋯, else to the card; Details… returns to the card when the Inspector closes. Items keep
`data-tile-menu`; Handoff is a link item; Bring to front / Send to back appear on Canvas only, not view-only. Wheel, a
scroll that moves the card, or a resize closes it.

**Legacy card menu.** `canvas.js` `legacyMenuElement`, `openLegacyMenu`, `runLegacyMenu`: `#legacy-tile-menu`, the same
pattern (content keeps `.workspace-tile-menu.legacy-tile-menu`). Items run through the menu's `action` event, not the
board's `data-open` / `data-tile-notes` / `data-remove-experiment` click handlers.

**Add and the board context menu.** `workspace-board.js` `addMenuItems`, `addMenuElement`, `addMenu`, `runAdd`: the same
items in two menus, `#workspace-add-menu` (Add is its `ui-menu-trigger`) and `#board-context-menu`, opened by a
right-click on empty canvas (the object lands at the pointer) or Shift+F10 on the focused canvas (its centre). Two
elements, so a right-click never marks Add expanded. T, S and D print as keycaps. Items keep `data-add`; tests scope
them as `#workspace-add-menu [data-add=…]`. `whiteboard.css` hides the drawn-object bar while an Add menu is open
(`.workspace-add-menu[data-open]`).

**Arrange.** `workspace-board.js` `arrangeMenuElement`, `arrangeMenu`, `positionArrangeMenu`: `#arrange-menu`, opened
from the selection bar's Arrange or the drawn-object bar's. A vertical menu with Align and Distribute groups whose items
carry their names (typeahead: "d" finds Distribute); Distribute is disabled (still focusable) below three objects. It
opens on the side of its bar away from the selection, and `positionArrangeMenu` re-reads that side when the view moves.
`arrangeMenu` writes the trigger's `aria-haspopup="menu"` and `aria-expanded`, whoever builds the button.

**Version stacks.** `workspace-board.js` `versionMenuElement`, `versionMenu`; `canvas.js` `#reader-version-menu` (with
`guardMenu`). The version name on a stack's card and in the reader's strip is a menu button listing every version as
radio items (name and modified time, `.tk-mi2`) that close the menu on choice; ‹ › still step. A Menu, not a Select
(§ 7, gap 4). It opens on the checked version, as a select or a native pop-up menu does (`openOnChecked` in
`popups.js`: once the SDK has placed its first focus, by keys or by a pointer, focus moves to the checked radio item). The name keeps a `role="status"` span, so stepping is announced. On a card the ticker is a roving toolbar
(§ Board canvas); the reader's version strip is a plain `ui-toolbar` (`board.html`). A focused stack card brings its
ticker in as one Tab stop.

**Drawn-object bar.** `whiteboard.js`, `text-appearance.js`, `container-layout.js`, `color-control.js`,
`preset-scrub.js`, `text-ink-preview.js`. The bar is a `ui-toolbar` built from `barParts` (`button`, `group`,
`choice`); toggle groups for arrow route, alignment, container layout, typeface, fill and border style; `openOnArrowDown`
opens every `[aria-haspopup]` button by clicking it.
- More: `#whiteboard-more-menu` (`mountPopups`, `openMenu`, `runMore`), anchored to the bar's current More (the bar
  re-renders as the selection saves), on the bar's side away from the object. Items carry `data-whiteboard-more`, not
  `data-whiteboard-action`, so the bar's click handler never runs them twice. Includes Bring to front / Send to back
  (typeahead "b").
- Container More options: a Popover `#whiteboard-container-popover` (gap and padding scrubbers, columns), centred on
  the bar away from the container. Closing it by any route completes a valid in-progress edit. Content keeps
  `.whiteboard-menu.whiteboard-container-layout`. Tab out continues from More options (`content.tabTrigger`).
- Format panels (Typeface, Text box, Ink, Text size, colour, drawing options) stay in the bar's own panel element and
  keep a popover's Tab through `tabOutOfPanel`; Escape and an outside press close them and focus returns to their
  button. Typeface is a toggle group. Text box: Color applies to (segmented), Fill style / Border style (toggle groups),
  the palette (radio group), Padding (scrub), and a Box height `ui-toolbar` (Auto height a `ui-toggle` with one name in
  both states; Fit height once a `ui-toolbar-button`, `aria-disabled` while a fit saves).
- The action rows at the end of Shape options and Line options (Bring to front, Send to back, and Edit text, Select
  section, Remove from container where they apply) look like menu rows, so they are one vertical `ui-toolbar` named
  "Actions" (`formatActions` in `renderObjectFormat`), as the % popover's zoom rows are: one Tab stop, ↑/↓ with wrap,
  Home/End. Tab from it leaves the panel (`tabOutOfPanel`).
- **Connection points** (`renderPorts`, `portKeys`). The four points round a selected Text block or shape, and the
  destinations shown once a connection has begun, are one Tab stop in a `role=group` "Connection points", as the
  comment pins are: the point focused last holds it (else the first). An arrow goes to that side's point of the same
  object (↑ top, → right, ↓ bottom, ← left) and, from a point already on that side, to the nearest point that way
  (`nearestInDirection` on screen boxes, among the destinations); Home and End reach the first and last. Enter or Space
  presses the focused point: the first begins a connection and focus stays on that point among the destinations. That
  click stops in `whiteboard.js`: choosing redraws the points, so the pressed one has left the page by the time the
  canvas's click handler reads it, and that handler took it for a click on empty canvas and cleared the selection and
  the connection just begun. Escape while connecting cancels it, and the points re-render under focus, so
  `handleEscape` sends focus back to the point the connection started from (`refocusSource`: it is the Tab stop
  again), else to its object. Escape on a point with nothing pending goes back to its object, selection kept, as
  Escape from the bar does (`focusRef`). Neither leaves focus on `<body>`.
- Where a panel starts (`focusPanelStart`, `text-appearance.js` `focus()`): the first control, unless one is marked
  `[data-autofocus]`; a group of choices is entered on its checked or pressed option. So Typeface starts on the chosen
  face, Text box on Color applies to, Ink and Text size on the chosen swatch / preset (a custom size: the scrub), Line
  options on the pressed arrowhead, Shape options on the chosen shape. A colour panel marks its palette
  `[data-autofocus]` (its × is not where the work starts).
- The bar in the Tab order (`mount`, `tabPastBar`, `focusBarKey`). The bar floats (`position: fixed`) but sits in the
  page right after `#viewport`, so the order is: the object → its own controls (label, resize corner, ports) → the bar
  (one stop) → what follows the board (kind legend, zoom pill, tools rail), and Shift+Tab back the same way, as a
  card's toolbar sits after its card. Panels follow by composition: their Tab-out sends focus to their button first
  (`tabOutOfPanel`; `content.tabTrigger` for the container options popover), and Tab past the bar goes on to the first
  stop after the board. While a text is edited, Tab from the editor goes to the bar, and Tab past the bar (or Shift+Tab
  from it) back to the editor. **Option-F10** (Alt+F10) jumps to the bar from anywhere outside a field: the key editors
  give their floating toolbars (TinyMCE, CKEditor, the WAI-ARIA Authoring Practices' rich-text toolbar), chosen over
  F6, which browsers and desktop apps use to cycle panes. **Escape** on the bar goes back to the object it edits with
  the selection kept, as Escape from an editor's toolbar returns to the text; Escape there deselects, which takes the
  bar away. Checked in `tests/board-fixes-browser.mjs`.
- Ink: the Ink button carries its displayed-ink description as `aria-description` and as its `data-tip`.
- Scrub handle (`preset-scrub.js`): § 5.

**Sticker picker.** `emoji-picker.js`, `emoji-picker.css`, `emoji-search.js`; openers in `workspace-board.js`
(`openStickerPicker(anchor, point)`, `closeStickerPicker()`: the tools rail's Sticker and the Add menu's Sticker row).
Popover, Toggle Group, Segmented Control; Core `createVirtualizer`, `createPreference`, `createLocalStorage`. Tests
`tests/sticker-picker-browser.mjs`, `tests/stickers.test.mjs`.
- Popup: a non-modal `ui-popover` made per open at the end of `<body>`, `api.open({anchor})` against the opener,
  `side=bottom align=center side-offset=6 collision-padding=8`. Focus to the search field (`initial-focus`). The opener
  gets `aria-expanded` and `aria-controls` while open and counts as part of the picker (its click toggles it closed;
  Shift+Tab back to it leaves it open). Tab order runs as if the picker followed its opener. An outside press closes
  it and reaches what it hit. Placing a sticker focuses and selects the new sticker; the picker closes because focus
  left it. The stylesheet loads on first open and the picker waits for it, so the SDK places it at its final size.
- Field: a combobox over a grid (`role=combobox`, `aria-haspopup=grid`, `aria-controls`, `aria-activedescendant`). The
  caret stays in the field: ↓ starts a highlight; with a highlight the four arrows move it (← → across row ends),
  PageUp/PageDown by the rows in view; ↑ from the first row ends it. Home/End move the caret. Typing highlights the best
  match, so Enter places it (combobox.md § Auto Highlight). Escape empties the query first (the popover's `escape-key`
  `openchange` is cancelled while there is one), then closes. Matching ignores case and accents (`words()`: NFKD, marks
  removed); the ranking (exact name, name prefix, every word a prefix, favourites) is upstream's, so the SDK's matching
  is not used.
- Grid: one Tab stop with one highlight, `role=grid` > `row` > `gridcell`, focus stays on the grid and
  `aria-activedescendant` names the cell (Listbox's `virtual-focus` model, so field and grid share one highlight). Keys
  are `createGridFocus`'s, implemented here: arrows, Home/End for the row, Ctrl/⌘+Home/End for the first and last
  sticker, PageUp/PageDown, Enter or Space places. A letter typed on the grid goes to the field. Hover highlights; a
  click places; a drag onto the board places where it drops. The foot names the highlighted sticker or counts the view;
  messages replace it in a `role=status`.
- Long list: `createVirtualizer` over rows (46 px; columns from the grid's width, 7 at 344 px), the highlighted row kept
  rendered (`keep`) and revealed with `scrollToIndex`. A category or all search results (up to ~1,900) scroll as one
  list. `aria-rowindex` on rows, `aria-rowcount`/`aria-colcount` on the grid.
- Categories: `ui-toggle-group deselectable=false` (← → move without choosing, Space/Enter chooses). While a search
  shows results, its value is `[]` (property write), so no category reads as chosen.
- Skin tone: `ui-segmented-control` (default and five tones). A chosen tone replaces each emoji that takes one with its
  one-tone variant (favourites and results too); a query naming "skin" or "tone" lists every variant. Remembered across
  boards: `createPreference` with `createLocalStorage('tinka/emoji-skin-tone')` (it insists on an `attribute`, which is
  applied nowhere).
- Keys: the picker stops keydown from reaching the board, except Escape, which goes on to the popover.

**Comment layer.** `comment-pins.js` `mountMenus`, `renderMenu`, `openCluster`, `dropOn`, `place`. The pins are one
Tab stop with arrows (§ Board canvas).
`#comment-layer-menu` (a `ui-menu-trigger` on the Comments button in the pill; ↓ opens it) with checkbox items Show
comments (⇧C) and Show resolved, which stay open as they toggle, then the threads waiting on you; "Nothing right now"
is a disabled item. `#comment-cluster-menu` opens beside a cluster pin, clear of the bottom bar (its
`collision-padding` is the bar's height). Placing a pin by keyboard: with the tool armed (C), Enter or Space on the
focused item drops the pin near its top-right corner (an arrow: at its middle), Enter on the focused canvas drops it at
the middle of the view (Space there still pans). The thread card opens as for a click, and closing it returns focus to
the item. While armed, the focused item is marked as the target ("On Card B"). Escape disarms.

**Comment thread card and the @ picker.** `comment-thread.js`, `comment-thread.css`, `comment-refs.js` (`attachPicker`).
- Card: a non-modal `ui-popover` appended to `<body>`, content `ui-popover-content.ct-card` opened with
  `api.open({anchor})`. The anchor's `getBoundingClientRect()` follows the pin while the board pans to it, then
  freezes. `side=right align=start side-offset=12 align-offset=-40 collision-padding=8`, flipping left, below, above;
  it never covers the pin. At ≤ 760 px, `presentation="sheet"` (the SDK's bottom sheet; it dims the page) styled
  `.ct-sheet`. `.ct-card` resets the global popover padding and overflow. Tab out closes it; the draft is kept.
- Escape peels one layer: `openchange` with `escape-key` is cancelled while the @ list is open (the card compares
  `detail.event` with the keydown it saw), then while editing or confirming a delete.
- Focus goes into the composer on open (retried each frame until shown). On close it returns to the element focused
  before, else the thread's pin, only when focus was lost and no other card opened meanwhile. Done in code
  (`final-focus="none"`): the pin is not a trigger. `content.tabTrigger` names the pin for Tab out.
- @ picker: a `ui-trigger-menu` around each composer (and the edit box), bound through an editor adapter
  (`menu.editor`) for the contenteditable: the text is the composer's with each chip as U+FFFC; `textBefore`,
  `selection`, `rectAt`, `replace`, `subscribe` are implemented there. The menu's content is created before the menu is
  connected (otherwise it makes its own). Items are `ui-trigger-menu-item`s in groups Items / Drawn / Boards, filtered
  by the SDK; empty groups are hidden in CSS. `itemselect` is cancelled and the existing chip insertion runs. Focus
  stays in the composer, which carries `aria-controls` and `aria-activedescendant`. The menu is nested in the card's
  popover, so a press in the list is not an outside press.
- The card stops keydown (except Escape) from reaching the board; ⌘↩ posts or saves.

**Comments panel.** `feedback.js`, `feedback.css`. ⋯ Conversation options is a shared Menu (`#feedback-options-menu`,
`openMenu`, ↓/↑ too): checkbox items Unresolved only and Show points stay open as they toggle (their `checked` attribute
is written back), then Add point (canvas only), Board discussion (an item's panel only) and Your name…. An action runs
once the menu has closed and returned focus, so the focus it moves stays. A click away only closes the menu: the
panel's own outside-press handler (window capture, ahead of the SDK) steps aside while a menu is open (`menuOpen()`),
and focus goes back to ⋯. The name is a field, so it is a Popover
(`#feedback-name-popover`) from As You or Your name…: focus in the field, Enter saves and closes, Escape returns to the
opener, Tab out continues after it (`tabTrigger`); the opener counts as part of it. Roots live in the panel's host
(`<body>`, or the reader `<dialog>`). Show points talks to the comment layer by events (`tinka:show-points` →
`comment-pins.js`, `tinka:points-shown` back). The panel's window Escape handler steps aside for `inPopup`.

**Vote ballot.** `feedback.js`: a non-modal Popover (`#feedback-ballot-popover`, content `.feedback-ballot`) under the
Vote button that opened it (a card's strip, the item Inspector, the reader Inspector). Yes / No / Abstain is a
single-choice `ui-toggle-group` (`choiceHTML`), because every vote writes at once and a radio group's arrows would vote
as they move: one Tab stop, arrows move without voting, Space/Enter votes. Focus opens on her vote, else Yes; Escape and
× return to the opener; a press on the Vote button toggles it. Built once per opening and updated in place, so focus
stays as the vote saves; a choice made while one saves waits, and the latest wins.

**Comparison order.** `order-list.js`, `workspace-board.js` `orderForm`: `fr-order-list` (role `listbox`,
`aria-roledescription` "reorderable list") > `fr-order-item` (`display: contents`) > `div.workspace-order-row` (role
`option`, roving `tabindex`, `aria-selected` and `data-grabbed` while picked up). Core `createRovingFocus` +
`createReorder` (`preview: true`: a dragged copy rides above the page and the list scrolls near its edges). Keys: the
SDK's pick-up model (core.md § Sort a List): Space/Enter pick up, ↑/↓ carry, Home/End to the ends, Space/Enter drop,
Escape puts it back (the dialog stays), Tab cancels. ⌥ ↑/↓ moves the focused row at once (`reorder.move`), with Shift to
an end: the board's reorder chord. The order is controlled (`list.value`, written back on `valuechange`); `subscribe`
redraws order and numbers, moving the other rows around the held or focused one, so it keeps focus and pointer capture.
A pointer drags a row (3 px threshold). Focus opens on the list.

**Board Inspector.** `canvas.js` `boardInspector`, `setInfoOpen`; `board.html` `#board-info-dialog`. A side panel. Its
Layout and Pattern rows are segmented controls. Board color opens a swatch radio group (`bindInspectorColor` in
`workspace-board.js`); while the board has a colour, "Remove color" follows the custom colour (one more Tab stop), as the
background image has "Remove image": it clears the colour, so the board stands on the Background chosen in Appearance,
closes the palette and returns focus to Board color. Pressed while a chosen colour is still saving, it waits for that
save and then clears (it used to do nothing). Board color and Background image… are drawn as the Filter row is,
so they are one `ui-toolbar` too ("Board background", `.inspector-background-row`): one Tab stop, ←/→ with wrap,
Home/End. The palette opens under the row, outside the toolbar, so its own arrows stay its own; Escape there comes back
to Board color, and closing the Background image dialog comes back to Background image…. The filter row
(`.inspector-toggles`) is a `ui-toolbar` around the `aria-pressed` buttons. The Edit row (Undo, Redo, Copy selection, Paste…, Comparison order…, and Open primary content,
Retry unsaved feedback, Recover unsaved text when they show) and the Feedback row (Comments, Export notes, Copy notes as
Markdown) are drawn as the Filter row is, so they are toolbars too, each named by its heading (`toolbarRow` in
`arrangeInspector`): one Tab stop, ←/→ with wrap, Home/End. A hidden button or a disabled one (Undo with nothing to undo)
leaves the arrow order (`followVisibility`); the app disables them with `setButtonOff` (§ Toolbars), so their buttons
still read `disabled` as before. Checked in `tests/last-fixes-browser.mjs`.

**Item Inspector.** `workspace-board.js` `itemControls`, `closeContext`. A side panel. Appearance rows are segmented
controls; Paper colour is a swatch radio group. The actions are a vertical `ui-toolbar` (`orientation="vertical"`, rows
that look like menu rows: ↑/↓ with wrap, Home/End). The Feedback row (Favorite, Comments, Vote) is a horizontal
`ui-toolbar` named by its heading, because the same actions are one toolbar on the card's strip: ←/→ with wrap,
Home/End, and ↓ on Vote opens the ballot (`openOnArrowDown`), as on the strip. Details shows Created / Edited as the exact
date in text (`exactTimeHTML` in `relative-dates.js`: "Nov 3, 2026, 2:02 PM"), as Finder's Get Info does, so nothing
there needs a tooltip and no date is a Tab stop. Relative dates with an exact-date tooltip stay where a date is a
passing remark (cards, Home, the Navigator), not focusable.

**Reader Inspector.** `canvas.js` `readerInspector`, `setReaderInfoOpen`, `renderReaderInfo` (keeps the opening focus
through its re-render); `board.html` `#reader-info-dialog`. A side panel. Its Feedback rows (Comments, Vote) are one
vertical `ui-toolbar` (↑/↓), for the same reason as the item Inspector's. Its Organize rows (Edit details…, Add board… or
Its board, Move to another board…, Also show on another board…, Feature on …) are drawn as the Feedback rows are and hold
the item Inspector's Move, so they are one vertical `ui-toolbar` too. Help stays a button (Keyboard shortcuts; Reload
content on a standalone page): one or two commands, not a set.

**Reader path.** `reader-path.js`, `board.html` `#reader-path-menu` (`ui-menu-trigger`, `guardMenu`). A Menu opened on a
press on the title or count. Each row is a place to go; "… n more" unfolds in place (`close-on-select="false"`). The
current place has `aria-current="true"` and its own quiet look (`popups.css`: a short mark-blue rule at the leading
edge, medium weight, "here"), never the highlight's fill, so the highlighted row is the only filled one.

**Notes column.** `#notes-panel` is an `aside` the reader lays out beside the content (the content narrows), named by
its heading. It behaves as a non-modal Dialog would: Notes opens it with focus in the field, Escape inside closes it and
focus returns to Notes, Tab moves on and it stays open, × closes it (§ 5).

**Resource surface.** `reader-resource-surface.js`, `reader-canvas.js`. No new controls; Window and zoom are the % popover
and pill. Keys follow the viewport norms (`+` / `−` / `0` / F, announced in `#reader-view-announce`).

**Keyboard pan of a zoomed Tinka** (the rule, `canvas.js` `READER_PAN`, `ReaderCanvas.overflows`). Plain ← / → step to the
previous / next Tinka (approved), so the arrows have two jobs, and the view decides which, as in macOS Preview and Photos
and Windows Photos: while all of the Tinka is in view (at fit, or zoomed out, or zoomed in on something small that still
fits), ← / → step; once part of it is out of view, every arrow pans towards the part it points at, 80 px a press (the
board's arrow pan) and a screenful with Shift, and a held arrow keeps panning. While zoomed they never step, not even
at an edge: a pan run to the edge that then jumped to another Tinka would move something she didn't ask to move, and
a held arrow would race past it. Stepping stays at any zoom on [ ] / J K / ⌥ ← →, and F (or zooming out until it fits)
gives ← / → their step back. Keys only on Tinka's own canvas and chrome (`readerTinkaFocus`); content, fields and
toolbars keep their arrows. The canvas's `aria-label` and the Keyboard shortcuts sheet say so. Fit's window has no
hint; a chosen Window size keeps its resize hint.

**Board map.** `board-map.js` (`mapHeadToolbar`, Escape and `0`), `canvas.js` (`actualSize`, announced zoom),
`calm.css` (`.board-map-head .board-map-tools { display: contents }`). The head ("Map": Fit selected, Fit board, Close)
is a `headerToolbar`, gathered as the module loads, before tooltips wrap the buttons; no keycaps in the head. The stage
stays `role="application"` (§ 5); its keys are the SDK viewport's: arrows pan, + / − zoom, 0 shows 100%, each zoom
announced ("Zoom 100%"). Escape anywhere in the map closes it and focus goes to its toggle; a tooltip showing takes the
first Escape. The board's key handler steps aside for the whole map.

**Kind legend.** `kind-legend.js`: a `ui-toggle-group` (not `multiple`: one family lit at a time) of `ui-toggle` around
the entry buttons. Space or Enter presses, arrows move focus, Escape lets go (unless a tooltip is open).

**Document reader.** `markdown-reader.js`, inside `media.html`, inside the reader's `item.html` frame. For the full
reader only, `loadSdk()` links `ui-sdk.css` (first) and `popups.css`, imports `tips.js`, `ui-toolbar.js` and `popups.js`;
card previews stay light, and until defined, popup content stays hidden (`media.css`). The bar is a `ui-toolbar`
("Document tools", a tooltip zone): the source link as `ui-toolbar-link`, Contents, Annotations, Edit, Reload;
`followVisibility`. Contents is a menu button (`#document-contents-menu`, typeahead, ↓ opens) listing the headings; a
choice scrolls to the heading. Annotations is a non-modal Popover (`#document-annotations-popover`, content
`.document-annotations`): focus moves in, Escape / Close / outside press close it, focus returns to the button; ↓ opens
it. Reload while busy is an `aria-disabled` toolbar item. The selection's Highlight / Comment bar is a `ui-toolbar`. The
in-place editor has no toolbar.

**Tile notes.** `tile-ui.js` `TileNotes`: a non-modal `ui-popover` in the body, anchored by a temporary
`data-note-anchor` attribute on the opener, so card handlers never hear it. Saving holds it open; Escape, a press
outside, Tab out and × keep the draft; Cancel drops it. Focus returns to the opener control.

**Quick jot.** `quick-jot.js`: a non-modal `ui-dialog` (a persistent bar; the board stays usable). Escape closes it from
inside and focus returns to where it came from.

**Update notice.** `update-notice.js`. The chip is rebuilt on every render, so it is not a trigger: its popover is one
`sharedPopover` (`modal="false"`, `final-focus="none"`) opened from code with the chip as anchor, content refilled per
state (compatible, review, failed). The SDK supplies Escape, outside press, focus leaving and placement (below the chip,
flipping above; width capped to the window). The chip is focused as it opens; `openchangecomplete` focuses
`.update-chip` again after Escape or a code close (not after a press elsewhere), since it may be a new element.
`content.tabTrigger` names the chip. The content keeps `workspace-popover` so the board Inspector stays open while it is
used. The major-update consent is a hand-built `ui-dialog` starting on Later; the policy control is segmented.

**Other dialogs.** `agent-prompt.js` (hand-built `ui-dialog.agent-dialog`, focus in its text), `home.html`/`home.js`
(the legacy `#new-dialog`; the organized Home's New board is `newBoardDialog`, compact, keeping its draft),
`comment-pins.js` (send-prompt: `makeDialog` with no submit), `workspace-board.js` / `workspace-home.js` (confirmations:
Remove placements, whose toast has an Undo action running the same undo as the shortcut; Remove from home;
Archive/Restore; Enable flexible boards). The Keyboard shortcuts sheet is a `makeDialog`.

## 5. Deliberately not on SDK components

| What | Why |
|---|---|
| The reader's native `<dialog>` | `showModal()` already gives what a modal `ui-dialog` gives; swapping would change every `dialog[open]` check and ~90 test selectors on lines upstream edits. The missing behaviour is added (§ Opened item). |
| Board canvas focus, move, resize, reorder, viewport | The Core context helpers need a part around every card, on the paths that must stay cheap. Implemented on the board's engine with standalone Core helpers (§ Board canvas). |
| The marquee (board and Home) | `createLasso` needs a part around every item, has no `scale` option for a zoomed canvas, commits the selection only on release, and has no page-scroll story. Ours selects live as the box grows and supports holding F or Z through it. Its keyboard behaviour (Escape cancels and keeps the old selection; Shift adds) is already ours; the count is announced on release. |
| The board map stage | A 2-D pan-and-zoom surface drawn on one canvas; the SDK ships no element for it, and `createViewport` needs a primitive. `role="application"` tells screen readers to pass the arrows through. |
| Copy preview (`copy-preview.js`) | The ghosts drawn while ⌥-dragging copies. Core's `bindDragPreview` clones one element into the top layer at screen scale, which would re-mount every card's live frame and lose the board's zoom and the objects' relative places. The ghosts already do what the SDK asks of a drag copy: an `aria-hidden`, `inert` layer, ids and board keys stripped, Escape cancels. |
| The scrub handle (`preset-scrub.js`) | Not `ui-slider` / `ui-number-input`: it also edits a mixed value by a relative amount and previews on the canvas. It has the SDK slider's keys (arrow step, Shift+arrow and Page Up/Down ten steps, Home/End bounds; a spinbutton when unbounded), previews on every step or drag tick, and commits once when the key comes up, the pointer lifts or focus leaves. No Alt small step: the values are whole pixels. |
| Standalone toggle buttons (Favorites, Last 6 weeks, Archive, auto height, automatic border) outside a toolbar | A native `aria-pressed` button already has the SDK toggle's keys. |
| Native radio fieldsets (`workspace-choice-pills`) | Native radios are already one Tab stop with arrows that check. |
| `<iframe title>` | The frame's accessible name, not a hint. |
| `return-mark.js` | The "Back to Tinka" chip the server adds to a project's own HTML page runs in a closed shadow root on a page Tinka didn't build and touches nothing else there, so it doesn't load the SDK. |
| The notes column | Already behaves as a non-modal Dialog; converting changes nothing she can feel. |
| Toolbars inside cards | `role=toolbar` roving markup, not `ui-toolbar`: no element or binding per card (§ Board canvas, § 6). |
| Sticker grid focus | `createGridFocus` moves real focus, which the search field could not share; the grid uses `aria-activedescendant` with the same keys. |
| The legacy Home shelf (`home.js`, organization off) | Unchanged upstream markup. |
| Board Inspector Edit and Feedback rows, reader Inspector Organize and Help rows | A panel's commands under headings, Tab-walked as in any dialog. None of them is a set of actions that is a toolbar elsewhere in the app (the item Inspector's Feedback row is: § 4). |

## 6. Performance rules

Pan, zoom and drag on a dense board are bound by style recalc. The reference board is `showcase-dense`: 84 cards, 560
hinted controls, 3,637 elements under `#viewport`. Probes run headless and interleaved, three rounds each; style time is
the trace's `UpdateLayoutTree` CPU per event. Probe scripts live outside the repository (`team/ux/perf/`,
`team/ux/r2/*/perf.mjs`).

### Restyle cost: the default-display rules

For every element defined with a default display, the SDK writes
`:where(TAG:not([hidden]), TAG[hidden="until-found"]) { display: contents }` into `<style id="ui-sdk-web-N">` (about
70 rules on a board page). Chrome can't bucket a two-argument `:where()` by its tag, so every rule was tried against
every element on every recalc: each whole-board restyle cost ~30% more (wheel event 11 → 15–19 ms). Bisected rule by
rule; the other injected rules (`[data-slot][hidden]`, the popover reset, `[as-child]`, `[align]`, `[data-mirror]`
with its `:dir(rtl)` flip) cost nothing measurable.

`watchSdkStyles()` in `ui-sdk.js` rewrites each rule to `:where(TAG):where(:not([hidden]), [hidden="until-found"])`:
the same match at the same specificity (0), with the tag bucketable. A `MutationObserver` on `<head>` re-applies it
whenever the SDK regenerates the sheet (each newly defined element). The vendored files stay unmodified. Not covered:
the same rules adopted into shadow roots (none of ours hold SDK parts).

### Pan writes only non-inherited properties on `#viewport`

`canvas.js` registers `--pattern-x` / `--pattern-y` (`CSS.registerProperty`, `inherits: false`). Only `#viewport`'s own
background reads them, so a pan frame restyles `#viewport` alone (under 0.1 ms) instead of every element under it
(about 11 ms). Any property written on `#viewport` per frame must be registered non-inherited or not written per frame;
`--canvas-zoom` and `--chrome-scale` are read by cards and change only on zoom. This fix is independent of the SDK and
upstream Tinka could take it.

### No per-frame view animation on input paths

Keyboard reveal moves in one step (`revealBox`). A glide that calls `applyView` every frame is only for app-chosen moves
(Fit, round steps).

### Nothing per card

No SDK element, wrapper or binding per card or drawn element. Card hints go through the tooltip delegate; card toolbars
are roving markup. Board focus runs on key, focus and press events only, with no observer.

Card tooltips, delegate against a trigger per control (medians of two loops; the second loop ran on a busier machine):

| | render warm | render cold | Ctrl-wheel zoom style | drag style | wheel-pan style |
|---|---|---|---|---|---|
| no card hints | 43.9 / 57.9 ms | 61.9 / 77.6 | 19.1 / 25.1 | 2.40 / 3.35 | 0.32 / 0.51 |
| delegate | 44.6 / 57.5 | 65.3 / 77.6 | 19.6 / 25.3 | 2.52 / 3.21 | 0.43 / 0.45 |
| a trigger per card control | 65.5 / 80.4 | 81.4 / 95.8 | 20.8 / 27.4 | 2.73 / 3.44 | 0.34 / 0.55 |

The delegate stays within run-to-run noise; wrappers cost 40–50% on a re-render, about 25% on a cold one, 6–9% on zoom
and drag. Before the pattern-offset fix, per-card wrappers cost about 20% more wheel-pan style work; wheel pan no longer
restyles the board, so the cost shows in render, zoom and drag. Input-to-present latency (2nd rAF) was equal across the
rows (headless frames quantize it). For reference, upstream 1.4 with the theme and no SDK: render 41.9 / 53.4 ms, and
15.7 / 21.0 ms of style per wheel-pan event (it lacks the pattern fix).

Card toolbars as roving markup, against the board before (medians):

| | render warm | render cold | wheel-pan style | Ctrl-wheel zoom style | drag style | wheel / drag latency |
|---|---|---|---|---|---|---|
| before | 58.0 ms | 78.3 | 0.56 | 24.2 | 3.25 | 45.6 / 29.6 |
| roving markup | 59.3 | 78.5 | 0.55 | 24.7 | 3.27 | 45.9 / 29.5 |

All within run-to-run spread (warm render ranged 55–62 ms on both). Element count is unchanged; the markup adds one
attribute per toolbar and `tabindex` on controls inside every non-stop card.

### Measuring input latency: use Chrome's EventLatency, not ack-gated CDP input

A probe that awaits each `Input.dispatchMouseEvent` / `dispatchTouchEvent` and then sleeps 16 ms, and scores
"2nd rAF after the event − `event.timeStamp`", showed wheel and touch pan on `showcase-dense` one frame slower than
`main` (46.5 against 30.4 ms) although the handler is a hundred times cheaper (0.2 against 20.6 ms). This is an artifact
of the probe. Two DevTools effects combine:

- DevTools holds each injected mouse or touch event in the browser until the renderer answers a
  `WidgetCompositor.VisualStateRequest`, that is, until its next compositor frame (the trace's
  `GenerationToBrowserMain` stage: 14 ms here against 5 ms on `main`). A real trackpad goes straight to the renderer.
- Awaiting the ack makes the input rate depend on the page: the "60 Hz" loop ran at 20 Hz on this branch and 30 Hz on
  `main`, so the two builds got different input streams, each phase-locked to its own frames.
- The 2nd rAF's timestamp is when that frame began, not when it reached the screen, so it leaves out `main`'s 20 ms
  of style work inside the frame.

Score latency with the trace's `EventLatency` events (category `input.scrolling`): Chrome's own time from event
generation to presentation feedback, per event, for presented frames. Drive the input the way a device does: a fixed
60 Hz clock that doesn't wait for acks, or `Input.synthesizeScrollGesture` (vsync-aligned, no DevTools hold). Medians of
five interleaved rounds against `main` (ms, ui-sdk at 29a978f / main):

| | dense: synth wheel | fixed wheel | fixed touch | fixed card drag | fixed marquee | keys |
|---|---|---|---|---|---|---|
| EventLatency | 20.9 / 50.4 | 31.6 / 65.8 | 34.5 / 62.2 | 24.1 / 29.2 | 24.5 / 14.8 | 13.4 / 24.9 |
| events presented | 64 / 50 | 90 / 69 | 89 / 63 | 89 / 86 | 89 / 88 | 41 / 41 |

Marquee is equal: `main`'s fixed-clock runs ranged 3.8–28.1 ms (ui-sdk 17.1–25.4), a traced rerun gave 25.6 / 28.7,
the gated driver 11.8 / 11.7, and the main thread's total work during the marquee is the same (392 / 424 ms).

On `showcase-containers` both builds sit within a frame of each other and the sign flips with the driver (synth wheel
34.5 / 31.4, fixed wheel 23.2 / 30.8, fixed touch 26.0 / 30.9). The main thread is busy 9–10% of the pan on this
branch against 22–29% on `main`, and no SDK observer, listener or timer runs on that path. Fixed-clock medians move by up
to a frame between runs (the clock's phase against vsync), so compare medians of several interleaved rounds. Probes:
`team/ux/r2/panperf/lat.mjs` (both methods, all scenarios), `trace.mjs` and `el.py` (stage breakdown).

### Long lists are virtualized

The sticker picker (`createVirtualizer`, about 60 cells in view plus overscan): open 14–16 ms warm on both upstream and
fribblr (30–34 ms cold, first open with the catalogue import); keystroke to results 3.2 ms against 3.3 ms; the input
handler 1.4 ms against 2.2 ms (fewer cells than upstream's 108-cell page). Medians of 5 warm runs, three runs each.

### Loading

`board-focus.js` loads Core with a dynamic import (`sdkCore()`), because `core.js` pulls in most of the SDK's chunks and
every use is on a key press. The document reader loads the SDK modules and stylesheets for the full reader only.

## 7. SDK gaps and workarounds

What 0.1.0-beta.10 lacks or gets wrong, and what fribblr does.

| # | Gap | Workaround |
|---|---|---|
| 1 | A menu item's `shortcut` attribute sets `aria-keyshortcuts="Control+…"` on a Mac while its hint reads ⌘. | `menuItem({shortcut})` writes `aria-keyshortcuts` (`ariaKeyshortcuts`) and the keycap (`formatShortcut`) itself. |
| 2 | `final-focus` on menu content is ignored for a menu opened from code; focus returns to "the element focused before". | `openMenu` focuses the opener just before opening; `returnTo` finds a re-rendered opener. |
| 3 | A Popover trigger does not open on ↓ (the toolbar norm for a menu button). | `openOnArrowDown`. |
| 4 | A Select with several external triggers (`for=`) marks them all expanded, anchors its list to the first and returns focus there. | Lists shared by rebuilt per-card triggers are Menus with radio items opened by `openMenu` (version stacks). |
| 5 | A toolbar doesn't know an item can be absent: a hidden item stays a Tab and arrow stop. | `followVisibility`, `headerToolbar`. |
| 6 | A cancelled `pressedchange` / `valuechange` is restored when the handler returns, overwriting an answer written inside it. | `onPress` / `onChoose` hand over in a microtask. |
| 7 | Items get their role and `tabindex` a microtask after insertion; a property write before upgrade is lost. | `focusSegmented`; `setSegmented`, `setChoice`, `setSwatch` fall back to `default-value`. |
| 8 | The default-display rules defeat Chrome's tag bucketing (~30% per whole-board restyle). | `watchSdkStyles` rewrite (§ 6). |
| 9 | Menu (and Select, Combobox, Date Picker) content keeps the UA popover border, padding and background. | `popups.css` (1). |
| 10 | Content parts can flash before their module upgrades them. | `:not(:defined) { display: none }` in `ui-sdk.css`. |
| 11 | `data-open` collides with the app's own attribute. | `[data-open]:not([data-slot])`. |
| 12 | Menu's `modal="pointer"` swallows the closing click but not its `pointerdown`. | The consumed-press guard (`sharedMenu`, `guardMenu`). |
| 13 | A closing popup stays shown until its animations end. | Panels with no exit animation finish their animations in `openchange`. |
| 14 | A tooltip trigger writes `type="button"` on its control, even a link, a heading, a `<time>` or an `<input type=range>`. | Form fields are always delegated; other controls accept it. |
| 15 | A tooltip trigger manages `aria-describedby` on its control. While a controller open shows a shared tooltip, the SDK writes `aria-describedby` on every wrapped trigger of that tooltip. | The delegate sets and restores `aria-describedby` on its own control; focus is then on the delegated control, so no screen reader hears the stray ones. |
| 16 | After a tap on one wrapped trigger of a shared tooltip, the next mouse hover on another is ignored until the pointer leaves a trigger (the press flag is per tooltip, and a tap's `pointerleave` comes before its click). | None; rare. |
| 17 | A hand-over within a shared tooltip is a payload change, so it doesn't re-animate. | Accepted (the instant hand-over is the norm). |
| 18 | A controller-opened tooltip sits in no layer, so Escape would reach the menu or dialog around it. | The delegate takes Escape on document capture and stops it. |
| 19 | `toast()` and the shortcut registry aren't exported by the browser build (the package root entry is missing); `createToaster()` for a second queue is unreachable. | `toaster()` and `shortcuts()` in `ui-sdk.js` read `Symbol.for('ui-sdk.toast@1')` and `Symbol.for('ui-sdk.shortcuts@1')`. |
| 20 | Core context helpers (`createRovingFocus`, `createMove`, `createLasso` …) need a primitive with a part per item; `createLasso` has no `scale`. | Board canvas on its own engine; marquee kept (§ 5). |
| 21 | `createPreference` insists on an `attribute`. | One is passed and applied nowhere (skin tone). |
| 22 | Escape inside a frame's SDK popup is `preventDefault`ed by the SDK. | Relied on: frame pages never post `reader-close` for it. |
| 23 | A popup opened from code (the ballot, a card's ⋯) has no trigger part, so nothing closes its opener's tooltip as it opens. | `tips.js` closes any open tooltip on every non-tooltip `openchange` (document capture). |
| 24 | A popup is shifted back into view only as far as it still touches its anchor, so an anchor past the window's edge takes the popup past it. | `openMenu` reads such an anchor clamped into the window (`inWindow`). |
| 25 | An outside press on something focusable leaves focus alone, expecting the press to focus it; a menu swallows that press, so focus falls to `<body>`. A press on nothing focusable is meant to return focus to the trigger after the press, which doesn't happen for a `for=` trigger. | `popups.js` focuses what the press would have (`focusAfterOutsidePress`; the board names the item or the canvas), else the trigger. |
| 26 | A toolbar doesn't skip a natively disabled button (the arrows stop on it), and it owns the button's `disabled` attribute, writing it from the part. | `setButtonOff` disables through the part; `followVisibility` reads a toolbar that isn't rendered again when it shows. |
| 27 | A toolbar's `data-orientation` arrives a microtask after the element, so a vertical toolbar measured at once lays out as a row. | `ui-sdk.css` lays out from the authored `orientation` too. |

### Upgrade checklist

When `vendor/ui-sdk/` changes version:

1. Replace the vendored files unmodified from the tarball and update `VERSION` (version, date, sha1). Read the docs'
   changes, starting at `docs/llms.txt`, and diff `custom-elements.json`.
2. **Default-display rules.** Find the successor of `Zr()` in `web/chunks/C59yJGP2.js` and check it still writes
   `:where(TAG:not([hidden]), TAG[hidden="until-found"])`. On a board page, check no `<style id="ui-sdk-web-N">` still
   contains `:not([hidden]), `. If the shape changed, update the regex in `ui-sdk.js` or drop the rewrite if the SDK
   fixed it, and re-run the wheel-pan probe.
3. **Globals.** `Symbol.for('ui-sdk.toast@1')` and `Symbol.for('ui-sdk.shortcuts@1')` still exist after loading
   `web/toast.js` / `web/menu.js`; or the browser build now exports `toast` and the registry, and `ui-sdk.js` can use
   them.
4. **Core exports used**: `definePrimitive`, `createParts`, `createChange`, `createRovingFocus`, `createSelection`,
   `createTypeahead`, `createFocusRecovery`, `createReorder`, `isTypeaheadKey`, `matchesShortcut`, `formatShortcut`,
   `ariaKeyshortcuts`, `nearestInDirection`, `announce`, `keepFocus`, `moveMessage`, `resizeMessage`, `reorderMessage`,
   `createVirtualizer`, `createPreference`, `createLocalStorage`. Check names and signatures, and the `moveMessage`,
   `resizeMessage`, `reorderMessage` wording the tests expect.
5. **Each gap in the table above.** If fixed, remove the workaround: the item `shortcut` attribute's Mac
   `aria-keyshortcuts` (gap 1), `final-focus` for code-opened menus (2), Popover trigger ↓ (3), Select external triggers
   (4), toolbar items that are absent (5), the restore timing of cancelled changes (6), the microtask role assignment
   (7), the UA popover box on Menu content (9), the tooltip press flag and `aria-describedby` behaviour (15, 16).
6. **Tooltip delegate.** Compare its constants and rules (600 ms delay, 400 ms group window, 4 px hull, modality rule,
   `data-instant`, dismissal reasons) with the successors of `web/chunks/CpFjFmpa.js` and `BT526ott.js` and
   tooltip.md.
7. **State attribute names** the CSS and code key on: `data-open`, `data-highlighted`, `data-checked`, `data-pressed`,
   `data-disabled`, `data-pending`, `data-instant`, `data-starting-style` / `data-ending-style`, `data-slot` values
   (`segmented-control-item`, `resizable-handle`, `*-content`).
8. **Injected CSS.** The `@layer ui-sdk` name, whether a `:not(:defined)` rule is still needed, and whether `inline`
   content still stays out of the top layer.
9. **Events and controllers**: `openchange` reasons (`outside-press`, `focus-out`, `escape-key`, `trigger-focus`,
   `trigger-hover`, `imperative`), `dismissattempt`, `payloadchange`, `openchangecomplete`, `api.open({anchor, payload,
   focus, reason, event})`, `api.getPayload()`.
10. **Revisit § 5.** A new element or a standalone form of a context helper (lasso with scale, a minimap, a viewport
    without a primitive) may retire a deliberate exception.
11. Run `npm test` and every browser test headless, including `tests/toolbars-browser.mjs`,
    `tests/tooltips-browser.mjs`, `tests/board-fixes-browser.mjs`, `tests/sticker-picker-browser.mjs`,
    `tests/navigator-browser.mjs`, `tests/feedback-browser.mjs`, `tests/document-browser.mjs`,
    `tests/inspector-commands-browser.mjs`, `tests/version-sheets-browser.mjs`.
12. Re-run the performance probes on `showcase-dense` (render, wheel pan, Ctrl-wheel zoom, drag) and compare with § 6.
