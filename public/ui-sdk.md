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
