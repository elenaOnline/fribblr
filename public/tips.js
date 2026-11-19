// Hover and focus hints on UI SDK's Tooltip (vendor/ui-sdk/docs/components/tooltip.md), in place of native titles.
//
// One shared tooltip per page (tooltip.md § Shared): a control carries its hint as data-tip="…" and is wrapped in
// <ui-tooltip-trigger for="tk-tip">, whose payload is the control itself; the content reads the hint when the payload
// changes. So the SDK supplies the norms (600 ms rest, instant hand-over along a row, one open at a time, keyboard
// focus opens at once and a click doesn't, a press hides it until the pointer leaves, Escape closes only it, the
// pointer can move into it, touch never shows it) and the page holds one tooltip, not one per control.
//
// Markup: <button data-tip="Fit every item in view" aria-keyshortcuts="F Shift+1">…</button>. The trigger wrapper is
// added by tips(root) after a render, or written in render markup with tipTrigger() so a reconciled render keeps it.
// It is the outermost of the button's wrappers (<ui-tooltip-trigger><ui-toolbar-button><ui-menu-trigger><button>):
// the tooltip trigger finds the button inside them, and the menu and toolbar parts still bind it (tooltip.md § Custom
// Rendering). Shortcuts come from the control's aria-keyshortcuts (or data-tip-keys when the control can't declare
// them) and show in a <ui-tooltip-shortcut>, hidden from screen readers, which hear aria-keyshortcuts instead.
// Inside the reader (a modal <dialog>, which makes the rest of the page inert) controls use a second tooltip that
// lives in the dialog.
import './vendor/ui-sdk/web/tooltip.js';
import {capFor, capLabel} from './keycaps.js';
import {isMacPlatform} from './reader-keys.js';
import {popupJustClosed} from './popups.js';

const FOREIGN = isMacPlatform() ? /(^|\+)Control\+/ : /(^|\+)Meta\+/;

const WRAPPERS = new Set(['UI-TOOLBAR-BUTTON', 'UI-TOOLBAR-LINK', 'UI-MENU-TRIGGER', 'UI-POPOVER-TRIGGER', 'UI-TOGGLE', 'UI-DIALOG-TRIGGER']);
export const TIP_ID = 'tk-tip';

const idFor = host => host === document.body ? TIP_ID : `${host.id}-tip`;
const hostOf = el => el.closest('dialog[id]') || document.body;

// The shared tooltip for a host (the page, or a modal dialog), made on first use.
function tooltipFor(host) {
  const id = idFor(host);
  let root = document.getElementById(id);
  if (root) return root;
  root = document.createElement('ui-tooltip');
  root.id = id;
  root.innerHTML = '<ui-tooltip-content class="tk-tip" data-height="float" collision-padding="8"><span class="tk-tip-text"></span><span class="tk-tip-keys"></span></ui-tooltip-content>';
  // A control marked data-tip-truncated (a title cut off with an ellipsis) shows its tip only while the text doesn't
  // fit (tooltip.md § Truncated Text), and an empty hint shows nothing. Handing over to one of those closes the tooltip.
  root.addEventListener('openchange', event => {
    if (!event.detail.value) return;
    // Focus coming back to a trigger after its popup closed doesn't reopen the hint (tooltip.md § Focus).
    if (quiet(root.api?.getPayload?.()) || (event.detail.reason === 'trigger-focus' && popupJustClosed())) event.preventDefault();
  });
  root.addEventListener('payloadchange', event => {
    if (quiet(event.detail.value)) { event.preventDefault(); queueMicrotask(() => root.api?.close?.()); return; }
    fill(root, event.detail.value);
  });
  host.append(root);
  return root;
}

// Nothing to say: an empty hint (data-tip="", a control whose hint applies only sometimes), or a truncated title that fits.
const quiet = el => el instanceof Element && (!el.dataset.tip || (el.hasAttribute('data-tip-truncated') && el.scrollWidth <= el.clientWidth));

// Visible name of a control, roughly as a screen reader computes it (enough to tell "has a name" and "same text").
function nameOf(el) {
  const label = el.getAttribute('aria-label')?.trim();
  if (label) return label;
  const by = el.getAttribute('aria-labelledby');
  if (by) return by.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
  let text = '';
  const walk = node => { for (const child of node.childNodes) {
    if (child.nodeType === 3) text += child.nodeValue;
    else if (child.nodeType === 1 && child.getAttribute('aria-hidden') !== 'true' && !child.hidden) walk(child);
  } };
  walk(el);
  return text.replace(/\s+/g, ' ').trim();
}

// The keys a control advertises, as the app prints them on keycaps ("⇧1", "⌘K", "Esc").
function keysOf(el) {
  if (el.dataset.tipKeys !== undefined) return el.dataset.tipKeys.split(/\s+/).filter(Boolean).map(key => capLabel(key));
  const all = (el.getAttribute('aria-keyshortcuts') || '').trim().split(/\s+/).filter(Boolean);
  if (!all.length) return [];
  // "Meta+K Control+K" is one command per platform: show the one for this platform. Different keys stay apart.
  const first = capFor(el), rest = [];
  for (const key of all) {
    const label = capLabel(key);
    if (label === first || FOREIGN.test(key)) continue;
    if (!rest.includes(label)) rest.push(label);
  }
  return [first, ...rest].filter(Boolean);
}

function fill(root, el) {
  const content = root.querySelector('.tk-tip');
  const text = content?.querySelector('.tk-tip-text'), keys = content?.querySelector('.tk-tip-keys');
  if (!text || !keys) return;
  const tip = el instanceof Element ? el.dataset.tip || '' : '';
  text.textContent = tip;
  // The tooltip describes its trigger (each control has a name of its own). When the hint only repeats that name,
  // screen readers would hear it twice: the words stay on screen and out of the description.
  if (el instanceof Element && tip && tip === nameOf(el)) text.setAttribute('aria-hidden', 'true'); else text.removeAttribute('aria-hidden');
  const caps = el instanceof Element ? keysOf(el) : [];
  keys.replaceChildren(...caps.flatMap((cap, i) => {
    const part = document.createElement('ui-tooltip-shortcut');
    part.className = 'tk-tip-key';
    part.textContent = cap;
    return i ? [document.createTextNode(' or '), part] : [part];
  }));
  keys.hidden = !caps.length;
}

// The outermost display:contents wrapper that holds only this control (a toolbar item, a menu trigger …).
function outerOf(el) {
  let outer = el;
  while (outer.parentElement && WRAPPERS.has(outer.parentElement.tagName) && outer.parentElement.children.length === 1) outer = outer.parentElement;
  return outer;
}

// Connect one control to the shared tooltip. Idempotent and cheap when already connected.
export function tip(el, text) {
  if (!el) return null;
  // Already connected (a re-render kept it): nothing to do.
  if (text === undefined && el.parentElement?.payload === el && !el.hasAttribute('title')) return el.parentElement;
  if (text !== undefined) el.dataset.tip = text;
  if (el.dataset.tip === undefined) return null;
  el.removeAttribute('title');
  // Every trigger of a shared tooltip needs a name of its own (tooltip.md § Shared).
  if (el.dataset.tip && !el.hasAttribute('aria-label') && !nameOf(el)) el.setAttribute('aria-label', el.dataset.tip);
  const outer = outerOf(el);
  let trigger = outer.parentElement?.tagName === 'UI-TOOLTIP-TRIGGER' ? outer.parentElement : null;
  const root = tooltipFor(hostOf(el));
  if (!trigger) {
    if (!outer.parentNode) return null; // not on the page yet: tips() connects it once it is
    trigger = document.createElement('ui-tooltip-trigger');
    trigger.setAttribute('for', root.id);
    outer.replaceWith(trigger);
    trigger.append(outer);
  } else if (trigger.getAttribute('for') !== root.id) trigger.setAttribute('for', root.id);
  if (trigger.payload !== el) trigger.payload = el;
  if (text !== undefined && root.querySelector('.tk-tip[data-open]') && root.api?.getPayload?.() === el) fill(root, el);
  return trigger;
}

// The element to place siblings next to: a control's tooltip trigger when it has one (inserting beside the control
// itself would put the newcomer inside the trigger, which binds the first button or link it holds).
export function tipOuter(el) {
  const outer = el ? outerOf(el) : el;
  return outer?.parentElement?.tagName === 'UI-TOOLTIP-TRIGGER' ? outer.parentElement : outer;
}

// Connect every [data-tip] control under root (and root itself).
export function tips(root = document) {
  if (!root) return;
  if (root instanceof Element && root.matches('[data-tip]')) tip(root);
  for (const el of root.querySelectorAll('[data-tip]')) tip(el);
}

// Render markup for a control that a reconciled render keeps: the wrapper is written in the markup, tips() sets its
// payload after the render.
export function tipTrigger(html, id = TIP_ID) {
  return `<ui-tooltip-trigger for="${id}">${html}</ui-tooltip-trigger>`;
}

// Change a control's hint; an open tooltip showing it follows.
export function setTip(el, text) {
  if (!el) return;
  if (el.dataset.tip === text) return;
  tip(el, text);
}

// True while a tooltip is showing. Escape then belongs to the tooltip (it closes only the tooltip, never the menu,
// panel or selection around it), so the board's capture-phase Escape handlers step aside (ui-sdk.js, popups.js).
// (The same one-line check is inlined in ui-sdk.js and popups.js, which must not load the tooltip module.)
export function tooltipOpen() {
  return typeof document !== 'undefined' && !!document.querySelector('ui-tooltip-content[data-open]');
}
