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
