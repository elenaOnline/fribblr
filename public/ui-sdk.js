// fribblr's one door to UI SDK (@ui-sdk/web, vendored in /app/vendor/ui-sdk/, Apache-2.0).
// How a surface is wired to it: see ui-sdk.md next to this file.
//
// Surfaces import the component entries they use from here (or from the vendored path directly), so one copy loads.
// This module also holds the few things the browser build only exposes as undocumented globals (toast, shortcuts),
// and the rule the board's own key handlers use to step aside for a widget that owns a key.

export const SDK = '/app/vendor/ui-sdk/web';

// Roles whose keys belong to the widget: arrows, Home/End, Enter/Space, Escape and typeahead letters.
const OWNS_ALL_KEYS = '[role=menu],[role=menubar],[role=listbox],[role=tree],[role=grid],[role=combobox],[role=dialog],[role=alertdialog],[data-slot$="-content"][data-open]';
// Roles that own navigation keys only; letters still reach the board's shortcuts, Escape still reaches the board.
const OWNS_NAV_KEYS = '[role=toolbar],[role=radiogroup],[role=tablist],[role=slider],[role=spinbutton],[data-slot=resizable-handle]';
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' ']);

// True when the focused widget (per UI SDK's norms) handles this key itself, so a board-level handler must not.
export function widgetOwnsKey(event) {
  // Escape with a tooltip showing closes only the tooltip (tooltip.md § Keyboard), wherever focus is.
  if (event?.key === 'Escape' && typeof document !== 'undefined' && document.querySelector('ui-tooltip-content[data-open]')) return true;
  const target = event?.target instanceof Element ? event.target : document.activeElement;
  if (!target?.closest) return false;
  if (target.closest(OWNS_ALL_KEYS)) return true;
  return NAV_KEYS.has(event?.key) && !!target.closest(OWNS_NAV_KEYS);
}

// An open SDK popup (menu, popover, dialog, select …) is showing anywhere on the page.
export function sdkPopupOpen() {
  return !!document.querySelector('[data-slot$="-content"][data-open]:not([data-slot^="tooltip"])');
}

// toast(): the default toaster the browser build creates when web/toast.js or web/overlays.js loads.
// Documented API: toast(message, options), toast.success/.error/.dismiss/.subscribe (toast.md). Reached by the
// versioned global because the package root entry is not in the browser build (team/ux/sdk/SPEC.md § A1).
export async function toaster() {
  await import(`${SDK}/toast.js`);
  const value = globalThis[Symbol.for('ui-sdk.toast@1')];
  if (!value) throw new Error('UI SDK toaster unavailable');
  return value;
}

// The shortcut registry (register(keys, handler, options) -> unregister; list(); setScope(name, on)).
export async function shortcuts() {
  await import(`${SDK}/menu.js`);
  return globalThis[Symbol.for('ui-sdk.shortcuts@1')] || null;
}

export async function defined(...tags) {
  await Promise.all(tags.map(tag => customElements.whenDefined(tag)));
}
