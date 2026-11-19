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
