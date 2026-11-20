// The opened item (#reader-dialog) behaves as UI SDK's modal Dialog (dialog.md; ui-sdk.md § Opened item).
//
// It stays the browser's own modal <dialog>: showModal() already gives what the SDK's modal Dialog gives (the top
// layer, the rest of the page inert and hidden from assistive technology, aria-modal). What the browser leaves out,
// and the SDK's Dialog does, is added here:
//
// - Tab wraps. The SDK's modal dialog keeps Tab inside: from the last control Tab goes to the first, Shift+Tab from
//   the first goes to the last (dialog.md § Modal: "trapped"). The browser's modal dialog lets Tab leave for the
//   browser's own toolbar instead. Popups inside (a menu, a nested modal dialog) keep their own Tab.
// - Focus goes back where it came from (popups.md § Focus): `rememberOpener()` notes what had focus as the reader
//   opens; `openerToReturnTo()` hands it back once the reader has closed, if it is still on the page and focusable.
//   (canvas.js returns focus to the card last viewed when the reader was opened from the board's cards.)
//
// Escape is the reader's own ladder in canvas.js (handleEscape): one layer at a time, the topmost first. An open UI
// SDK popup inside the reader (a menu, a popover, a tooltip, a nested dialog) takes its own Escape before the ladder
// (inPopup in popups.js).

const TABBABLE = 'a[href],button,input,select,textarea,iframe,summary,[tabindex],[contenteditable=""],[contenteditable="true"]';
// Containers inside the reader that keep their own Tab: a nested modal dialog traps it, a menu closes on it, a popover
// (the % popover) walks out to its trigger's next control (popups.js).
const OWN_TAB = 'dialog,[aria-modal="true"],ui-alert-dialog-content,ui-menu-content,ui-popover-content,ui-select-content,[role="menu"],[role="listbox"]';

export function tabStops(root) {
  return [...root.querySelectorAll(TABBABLE)].filter(element => {
    if (element.tabIndex < 0 || element.disabled || element.closest('[hidden],[inert]')) return false;
    const own = element.closest(OWN_TAB);
    if (own && own !== root && root.contains(own)) return false;
    if (!element.getClientRects().length) return false;
    return getComputedStyle(element).visibility !== 'hidden';
  });
}

export function trapTab(dialog) {
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || !dialog.open) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(OWN_TAB) !== dialog) return;
    const stops = tabStops(dialog);
    if (!stops.length) return;
    const first = stops[0], last = stops[stops.length - 1];
    const at = edge => target === edge || edge.contains(target);
    if (event.shiftKey ? at(first) : at(last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  });
}

let opener = null;
// What had focus as the reader opened (the card's Open, the Navigator's row, a link on the page …).
export function rememberOpener(dialog) {
  const element = document.activeElement;
  opener = element && element !== document.body && !dialog.contains(element) ? element : null;
  return opener;
}
// The element to return focus to after the reader closed: the one that opened it, while it is still on the page,
// visible and focusable. Otherwise null (the caller falls back to the board).
export function openerToReturnTo() {
  const element = opener;
  opener = null;
  if (!element?.isConnected || element.disabled || element.closest('[hidden],[inert]') || !element.getClientRects().length) return null;
  return element;
}
