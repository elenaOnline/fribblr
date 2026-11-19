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

## Surfaces

Each surface lists its files and the SDK components it uses. Added as surfaces land.

### Toasts, dialogs, confirmations, notes popover, Quick jot (overlays stream)

Files: `toasts.js` (new), `workspace.js` (`makeDialog`, `confirmDialog`, re-exports `toast`), `agent-prompt.js`,
`update-notice.js`, `home.html`, `tile-ui.js` (`TileNotes`), `quick-jot.js`, `comment-pins.js` (send-prompt dialog);
CSS in `workspace.css` (`.workspace-toasts`, `.workspace-toast`, dialog backdrop, `.workspace-alert`), `home.css`,
`update-notice.css`, `whiteboard.css`.

- **Toast** (`ui-toast-region` + the default toaster). `toast(message, options)` from `workspace.js` is the only call
  site API; it stays synchronous and returns the toast's id (`dismissToast(id)` closes it). `toasts.js` builds one
  region per page on first use (bottom centre, where the old status node sat) with a close button and an action slot;
  duration is kept at 6 s. Live status regions that are not toasts (connection, form status) are untouched. Tests find
  toasts by `.workspace-toast`; several can be on screen at once, so use `.first()`/`.last()`/`filter`.
- **Dialog** (`ui-dialog`, modal). `makeDialog(title, body, onSubmit, {className})` keeps its shape: it returns the
  `ui-dialog-content` element (class `workspace-dialog`), which has `close()` and fires a `close` event once closed.
  Focus opens on the first field (`autofocus` is set on it), else the close key; Tab wraps; Escape and a press on the
  backdrop close; focus returns to what had it. A form with typed-in changes asks "Discard your changes?" (an alert
  dialog) before Escape or the backdrop throw them away; the × key never asks. ⌘↩ still saves (`bindForm`). A dialog
  opened over another dialog, or over the reader's native modal `<dialog>`, is appended inside it, otherwise the
  parent's inert page would include it.
- **Alert dialog** (`ui-alert-dialog`). `confirmDialog({title, description, confirmLabel, cancelLabel, onConfirm})`
  resolves true for the confirming answer. Focus opens on Cancel, Escape means no, a backdrop press does nothing.
  `onConfirm` (async) keeps the dialog open with the confirm key pending and shows a failure inside it. Used for
  Remove placements, Remove from home, Archive/Restore everywhere, Enable flexible boards.
- **Agent prompt, update consent, Home new-board dialogs** are `ui-dialog` with their own classes
  (`agent-dialog`, `update-dialog`, `home-dialog`); the update dialog starts on Later (`autofocus`).
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
  `ui-dialog-content[data-open],ui-alert-dialog-content[data-open]`.
