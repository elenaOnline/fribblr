// fribblr's popups on UI SDK Menu and Popover: the one pattern every menu and popover in the app follows.
// How and why: ui-sdk.md § Popups. Looks: popups.css.
//
// - A popup's root and content live at the end of <body> (or inside the modal dialog that hosts them), never inside a
//   card, a toolbar or any other clickable container: popup events bubble to their DOM ancestors (docs/popups.md).
// - A fixed trigger (Add, Comments, More…) reaches its popup with `for=`; a trigger that is rebuilt with its container
//   (a card's ⋯, a selection bar button) and every point-anchored context menu open it from code with
//   `api.open({anchor, payload, focus})`. One menu element serves every card.
// - Menu's default modal="pointer" consumes the outside press that closes it. The board's own pointer handlers must
//   not see that press either (it would select or drag the card under it): see the guard at the end of this file.
import './vendor/ui-sdk/web/menu.js';
import './vendor/ui-sdk/web/popover.js';
import {formatShortcut, ariaKeyshortcuts} from './vendor/ui-sdk/web/core.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

// A menu with no trigger of its own, appended to `host`. Content carries .tk-menu (the float height and the menu face)
// plus any class of the surface's own.
export function sharedMenu({id, label = '', className = '', host = document.body, contentId = ''}) {
  const root = document.createElement('ui-menu');
  root.id = id;
  root.innerHTML = `<ui-menu-content${contentId ? ` id="${esc(contentId)}"` : ''} class="tk-menu ${esc(className)}"${label ? ` aria-label="${esc(label)}"` : ''}></ui-menu-content>`;
  host.append(root);
  watchConsumedPresses(root);
  // Tab closes a menu and moves on from where it was opened. A menu with a trigger gets that from the SDK (it focuses
  // the trigger as it closes); this one lives at the end of <body>, so focus goes back to its opener first and the
  // browser's Tab continues from there.
  root.addEventListener('keydown', event => {
    if (event.key === 'Tab' && root.open && root.returnTo) document.querySelector(root.returnTo)?.focus({preventScroll: true});
  }, true);
  // Escape and a chosen item send focus back to that opener too (popups.md § Focus: a controller-opened popup
  // returns to what had focus before; a right-click the menu consumed never moved focus, so the opener is better).
  // The board may re-render the opener while the menu is open (a card, a selection bar): when the SDK's fallback
  // leaves focus on <body>, the opener's selector finds its new copy.
  root.addEventListener('openchangecomplete', event => {
    if (!event.detail.value && root.returnTo && (document.activeElement === document.body || !document.activeElement)) document.querySelector(root.returnTo)?.focus({preventScroll: true});
  });
  const content = root.querySelector('ui-menu-content');
  return {root, content};
}
// Opens a shared menu from code. `anchor` is the element or {x, y} point it opens against. The opener (`returnTo`, a
// selector that survives the board re-rendering its cards; else the anchor element, the pressed control or what had
// focus) is where Escape, a chosen item and Tab send focus back. The SDK returns a controller-opened menu's focus to
// "the element focused before it" and, in 0.1.0-beta.10, ignores final-focus there, so the opener takes focus just
// before the menu opens (a right-click the menu consumed would otherwise leave focus wherever it last was).
export function openMenu(root, {anchor, payload, event, focus, returnTo} = {}) {
  document.querySelectorAll(`[data-menu-return="${root.id}"]`).forEach(element => element.removeAttribute('data-menu-return'));
  if (typeof returnTo !== 'string') {
    const pressed = event?.target instanceof Element ? event.target.closest('button,a[href],[tabindex]') : null;
    const element = returnTo || (anchor instanceof Element ? anchor : null) || pressed || document.activeElement;
    element?.setAttribute?.('data-menu-return', root.id);
    returnTo = element && element !== document.body ? `[data-menu-return="${root.id}"]` : '';
  }
  root.returnTo = returnTo;
  const opener = returnTo ? document.querySelector(returnTo) : null;
  if (opener && document.activeElement !== opener) opener.focus({preventScroll: true});
  return root.api.open({anchor, payload, focus: focus ?? openFocus(event), event});
}

// A popover root with its content, appended to `host`; triggers reach it with `for=`.
export function sharedPopover({id, label = '', className = '', host = document.body}) {
  const root = document.createElement('ui-popover');
  root.id = id;
  root.innerHTML = `<ui-popover-content class="${esc(className)}" data-height="float"${label ? ` aria-label="${esc(label)}"` : ''}></ui-popover-content>`;
  host.append(root);
  return {root, content: root.querySelector('ui-popover-content')};
}

// The shortcut hint the app already shows, as a keycap, in the SDK's notation ("mod+d", "e", "enter", "shift+1"):
// it reads ⌘ on Apple platforms and Ctrl elsewhere, and the item declares aria-keyshortcuts. HTML items only display
// a shortcut; the board's own key handlers run it. We write both ourselves rather than use the item's `shortcut`
// attribute: in 0.1.0-beta.10 that attribute's aria-keyshortcuts says Control on a Mac while its hint says ⌘
// (ui-sdk.md § Popups). The <kbd> inside also tells keycaps.js the row already prints its key.
const keycap = shortcut => `<ui-menu-shortcut><kbd class="tk-kbd">${esc(formatShortcut(shortcut).replace(/[\u2066-\u2069]/g, ''))}</kbd></ui-menu-shortcut>`;
const keys = shortcut => shortcut ? ` aria-keyshortcuts="${esc(ariaKeyshortcuts(shortcut))}"` : '';

// One plain item. `icon` is decorative markup kept out of the accessible name and typeahead.
export function menuItem(value, label, {shortcut, disabled, destructive, icon, title, className = '', attrs = ''} = {}) {
  return `<ui-menu-item class="tk-mi ${className}" value="${esc(value)}"${keys(shortcut)}${disabled ? ' disabled' : ''}${destructive ? ' destructive' : ''}${title ? ` title="${esc(title)}"` : ''} ${attrs}>${icon ? `<ui-menu-item-icon>${icon}</ui-menu-item-icon>` : ''}<span class="tk-mi-label">${esc(label)}</span>${shortcut ? keycap(shortcut) : ''}</ui-menu-item>`;
}
// An item that is a link (Enter follows it like a click, keeping target and modifier keys).
export function menuLink(href, label, {target = '_blank', className = ''} = {}) {
  return `<ui-menu-item as-child><a class="tk-mi ${className}" href="${esc(href)}"${target ? ` target="${esc(target)}" rel="noopener noreferrer"` : ''}><span class="tk-mi-label">${esc(label)}</span></a></ui-menu-item>`;
}
export function menuCheckbox(value, label, {checked = false, shortcut, disabled, title} = {}) {
  return `<ui-menu-checkbox-item class="tk-mi" value="${esc(value)}" checked="${checked}"${keys(shortcut)}${disabled ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}><ui-menu-item-indicator class="tk-mi-check" keep-mounted>${CHECK}</ui-menu-item-indicator><span class="tk-mi-label">${esc(label)}</span>${shortcut ? keycap(shortcut) : ''}</ui-menu-checkbox-item>`;
}
// A radio group: [[value, label, {detail}]…]; `value` is the chosen one. `detail` is a quiet second line (a modified
// time). Radio items stay open as they change (menu.md); `closeOnSelect` makes a choice close the menu, for a group
// that picks what to show rather than a setting.
export function menuRadioGroup(name, label, options, value, {disabled = false, title = '', closeOnSelect = false} = {}) {
  return `<ui-menu-radio-group name="${esc(name)}" value="${esc(value)}"${title ? ` title="${esc(title)}"` : ''}>${label ? `<ui-menu-group-label class="tk-mlabel">${esc(label)}</ui-menu-group-label>` : ''}${options.map(([v, text, {detail = ''} = {}]) => `<ui-menu-radio-item class="tk-mi${detail ? ' tk-mi2' : ''}" value="${esc(v)}"${disabled ? ' disabled' : ''}${closeOnSelect ? ' close-on-select' : ''}${detail ? ` label="${esc(text)}"` : ''}><ui-menu-item-indicator class="tk-mi-check" keep-mounted>${CHECK}</ui-menu-item-indicator><span class="tk-mi-label">${esc(text)}${detail ? `<small>${esc(detail)}</small>` : ''}</span></ui-menu-radio-item>`).join('')}</ui-menu-radio-group>`;
}
export function menuGroup(label, items) {
  return `<ui-menu-group>${label ? `<ui-menu-group-label class="tk-mlabel">${esc(label)}</ui-menu-group-label>` : ''}${items}</ui-menu-group>`;
}
export const menuSeparator = '<ui-menu-separator class="tk-msep"></ui-menu-separator>';
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>';

// How a press opened something, as the SDK reads it: a keyboard press (Enter/Space on a button: click detail 0, or a
// keydown) moves focus to the first item; a pointer press focuses the menu itself, with no item highlighted.
export function openFocus(event) {
  if (!event) return 'first';
  if (event.type === 'keydown') return event.key === 'ArrowUp' ? 'last' : 'first';
  if (event.type === 'click') return event.detail === 0 ? 'first' : 'popup';
  if (event.type === 'contextmenu') return keyboardContextMenu(event) ? 'first' : 'popup';
  return 'popup';
}
// Shift+F10 or the context-menu key fire contextmenu without a right button (the rule ui-menu-context-trigger uses).
export function keyboardContextMenu(event) {
  return event.button !== 2 && !event.ctrlKey && event.pointerType !== 'touch' && event.pointerType !== 'pen';
}

// ---- The consumed outside press ----
// Menu's modal="pointer" closes on an outside press and swallows its click (the SDK's window capture listener). The
// pointerdown itself still travels on to the board, whose handlers would select, drag or marquee from it. Each shared
// menu records the press that closed it; a document capture listener (registered before the board's) stops it there.
const consumed = new WeakSet();
function watchConsumedPresses(root) {
  root.addEventListener('openchange', event => {
    const {value, reason, event: cause} = event.detail || {};
    if (!value && reason === 'outside-press' && cause && root.getAttribute('modal') !== 'false') consumed.add(cause);
  });
}
// A menu that keeps its own trigger in place (wrapped in <ui-menu-trigger>) joins the same guard.
export function guardMenu(root) { watchConsumedPresses(root); return root; }
// When a popup (menu, popover) last closed. Focus then goes back to the control that opened it, and a tooltip on that
// control must not reopen for it (tooltip.md: "Focus returning to the trigger after its popover closes doesn't reopen the
// tooltip"): the SDK does that for its own trigger wrappers, but a popup opened from code (Arrange) has none, so tips.js
// asks here.
let lastPopupClose = -Infinity;
// Code that returns focus to a control after closing something that is not an SDK popup (the Inspector) says so here.
export const notePopupClosed = () => { lastPopupClose = performance.now(); };
export const popupJustClosed = (within = 400) => performance.now() - lastPopupClose < within;
if (typeof document !== 'undefined') for (const type of ['openchange', 'openchangecomplete'])
  document.addEventListener(type, event => { if (event.detail?.value === false && !/^tooltip/.test(event.target?.dataset?.slot || event.target?.tagName?.toLowerCase().replace(/^ui-/, '') || '')) lastPopupClose = performance.now(); }, true);

// True while one of the app's menus is open: board handlers that run before the SDK's (window capture) check it.
export function menuOpen() { return !!document.querySelector('ui-menu-content[data-open]'); }
if (typeof document !== 'undefined') document.addEventListener('pointerdown', event => { if (consumed.has(event)) event.stopImmediatePropagation(); }, true);
// (Pointer-event compatibility mousedowns never fire for a press whose pointerdown the SDK prevented.)

// True when a key or press comes from inside an open SDK popup (menu, popover …). The board's capture-phase Escape
// ladders and command keys step aside for it: the popup's own handlers (Escape peels one layer, typeahead, arrows)
// run after them. widgetOwnsKey() (ui-sdk.js) covers the board command keys; this narrower check is for handlers that
// must keep their keys in non-popup dialogs such as the Inspector.
export function inPopup(event) {
  // Escape with a tooltip showing belongs to the tooltip: it closes only the tooltip (tooltip.md § Keyboard).
  if (event?.key === 'Escape' && typeof document !== 'undefined' && document.querySelector('ui-tooltip-content[data-open]')) return true;
  const target = event?.target instanceof Element ? event.target : document.activeElement;
  if (target?.closest?.('[data-slot$="-content"][data-open]:not([data-slot^="tooltip"])')) return true;
  // The trigger of a popup that has just opened: focus moves into it a frame later, and a key pressed in that frame
  // (Escape right after a click) still belongs to the popup, whose layer takes it.
  const controls = target?.closest?.('[aria-expanded="true"][aria-controls]')?.getAttribute('aria-controls');
  return !!(controls && document.getElementById(controls)?.matches('[data-slot$="-content"][data-open]'));
}

// A menu or popover trigger inside a horizontal ui-toolbar opens on ArrowDown (the toolbar norm: arrows along the bar
// move between items, Down opens a menu button; toolbar.md). `open(event)` opens it with focus on the first item.
// Delegated on the toolbar, which survives its buttons being re-rendered; `selector` names the trigger buttons.
export function openOnArrowDown(toolbar, selector, open) {
  toolbar?.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const button = event.target.closest?.(selector);
    if (!button || !toolbar.contains(button) || button.disabled) return;
    event.preventDefault(); event.stopPropagation();
    open(event, button);
  }, true);
}

// ---- Tab out of a popup that lives at the end of <body> ----
// A non-modal popover or dialog is part of the page's Tab order right after its trigger (popover.md: "Tab from the last
// element moves focus to the element after the trigger"; Shift+Tab from the first returns to the trigger; with a
// popover, focus leaving closes it). Our content sits at the end of <body>, so the browser's next stop after its last
// control is nothing. Here the Tab is steered by hand: forward from the last control, the popup (a popover) closes
// and focus goes to the trigger, so the browser's own Tab continues from there; backward from the first, focus goes
// to the trigger. Needs a trigger the page can find: `ui-popover-trigger[for]`, or a button with aria-controls.
const TABBABLE = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"]';
function tabbablesIn(content) {
  return [...content.querySelectorAll(TABBABLE)].filter(element => {
    if (element.disabled || element.hidden || element.closest('[hidden],[inert]')) return false;
    if (element.tabIndex < 0 && !element.isContentEditable) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  });
}
function triggerOf(content) {
  // A popup whose trigger the page can't point at (the comment card's pin is rebuilt as pins regroup) names it itself.
  const named = content.tabTrigger?.();
  if (named instanceof HTMLElement && !content.contains(named)) return named;
  const root = content.closest('ui-popover,ui-dialog') || content.parentElement;
  const found = (content.id && document.querySelector(`[aria-controls="${CSS.escape(content.id)}"]`))
    || (root?.id && document.querySelector(`ui-popover-trigger[for="${CSS.escape(root.id)}"] button, ui-dialog-trigger[for="${CSS.escape(root.id)}"] button`));
  return found instanceof HTMLElement && !content.contains(found) ? found : null;
}
if (typeof document !== 'undefined') document.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const target = event.target instanceof Element ? event.target : null;
  const content = target?.closest('ui-popover-content[data-open],ui-dialog-content[data-open]:not([aria-modal="true"])');
  // The popup's root (in a sheet the content sits inside the root's viewport, not directly in it).
  const host = content?.closest('ui-popover,ui-dialog');
  if (!content || !host || host.parentElement !== document.body) return;
  if (content.getAttribute('aria-modal') === 'true' || host.getAttribute('modal') === 'true' || host.getAttribute('modal') === 'trap-focus') return;
  const trigger = triggerOf(content);
  if (!trigger) return;
  const stops = tabbablesIn(content);
  if (!stops.length) return;
  const first = stops[0], last = stops[stops.length - 1];
  if (event.shiftKey ? (target === first || first.contains(target)) : (target === last || last.contains(target))) {
    if (event.shiftKey) event.preventDefault();
    else if (content.matches('ui-popover-content')) host.api?.close?.();
    trigger.focus({preventScroll: true});
  }
}, true);
