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
  // The delegate (below) follows every open, close and hand-over, whoever caused it.
  root.addEventListener('openchange', event => { if (!event.defaultPrevented) queueMicrotask(() => settled(root)); });
  root.addEventListener('payloadchange', event => { if (!event.defaultPrevented) queueMicrotask(() => settled(root)); });
  roots.add(root);
  host.append(root);
  return root;
}
const roots = new Set();

// Nothing to say: an empty hint (data-tip="", a control whose hint applies only sometimes), or a truncated title that fits.
// data-tip-truncated may name the descendant whose text is cut off (a row's name inside its link); cut off sideways
// (an ellipsis) or downwards (a line clamp).
const quiet = el => el instanceof Element && (!el.dataset.tip || (el.hasAttribute('data-tip-truncated') && fits(el.dataset.tipTruncated && el.querySelector(el.dataset.tipTruncated) || el)));
const fits = el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight + 1;

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
  // Inside a delegated zone (the board's cards, segmented controls) the control keeps no wrapper: the delegate below
  // serves it. A changed hint still reaches an open tooltip.
  if (el.closest(ZONE)) {
    if (text !== undefined && current?.el === el && current.root.api?.getPayload?.() === el) fill(current.root, el);
    return null;
  }
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
  if (root instanceof Element && root.matches('[data-tip]') && !root.closest(ZONE)) tip(root);
  for (const el of root.querySelectorAll('[data-tip]')) if (!el.closest(ZONE)) tip(el);
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

// ---------------------------------------------------------------------------------------------------------------------
// Delegated hints: controls that sit where a trigger wrapper per control costs too much, or where a wrapper can't go.
//
// The board's cards carry hundreds of hinted controls (showcase-dense: 84 cards × 6–7). A <ui-tooltip-trigger> around
// each one made every whole-board restyle about 20% slower (wheel pan, the hottest path; ui-sdk.md § Tooltips). A
// segmented item can't sit in a trigger either without leaving its control's direct-child rules. So a control inside a
// [data-tip-zone] (the board's #world) or a segmented control carries only data-tip, gets no wrapper (tips() skips it), and one
// set of listeners on the document opens the page's shared tooltip for it through the tooltip's controller
// (api.open({anchor, payload})): nothing per card, nothing on the pan, zoom or drag paths.
//
// The delegate reproduces the norms the SDK's own trigger gives (tooltip.md § Delay and Grouping, § Keyboard, § Tested
// Behavior; the source is web/chunks/CpFjFmpa.js and BT526ott.js in 0.1.0-beta.10):
//   - the pointer rests 600 ms (the tooltip's `delay`) before the first one opens;
//   - while a tooltip is open, or closed less than 400 ms ago (the SDK's group window; the docs say "a moment ago"),
//     the next opens at once, and opening one closes the other: the SDK's group does that for controller opens too,
//     and marks the instant one data-instant;
//   - leaving the control closes it (close-delay 0) unless the pointer is on its way to the tooltip: the convex hull of
//     the control and the tooltip, 4 px out, as the SDK computes it;
//   - keyboard focus opens it at once; a click that focuses does not (the last input was a pointer: the SDK's modality
//     rule, which a window blur also mutes until the next key); focus leaving closes a tooltip that focus opened;
//   - a press (pointer down, Enter, Space) closes it, and after a pointer press it stays closed until the pointer
//     leaves the control;
//   - Escape closes only the tooltip, and a press outside, a window blur: the SDK's dismissal does these for any open;
//   - touch never opens one.
// Where the canvas needed a rule the SDK has no case for: a pointer moving with a button held (a drag, a marquee)
// opens nothing, as native titles never did; a control that leaves the page while its tooltip shows closes it.
// Hand-over works both ways with the wrapped chrome: both open the same shared tooltip, so the SDK's group sees one
// tooltip.
const DELAY = 600, WARM = 400, HULL_PAD = 4;
const ZONE = '[data-tip-zone], ui-segmented-control';
let modality = 'pointer', windowBlurred = false;
let lastClosed = -Infinity;
const openRoots = new Set();
let current = null;   // {el, root, by: 'hover' | 'keyboard', describedBy}
let hovered = null;   // the delegated control under the pointer
let pending = null;   // {el, timer}
let pressed = null;   // a control pressed with the pointer: no hover tooltip until the pointer leaves it
let tracking = null;  // pointermove listener while the pointer travels from the control to the tooltip

// A control the delegate serves: it carries data-tip and has no trigger wrapper of its own.
// An iframe inside a hinted element (the reader's window) is the page it shows, not the hint's control: as with a native
// title, the hint shows only over the element's own box.
function delegated(target) {
  const el = target instanceof Element && target.tagName !== 'IFRAME' ? target.closest('[data-tip]') : null;
  if (!el) return null;
  const outer = outerOf(el);
  return outer.parentElement?.tagName === 'UI-TOOLTIP-TRIGGER' ? null : el;
}

function settled(root) {
  const open = !!root.api?.isOpen?.();
  if (open) openRoots.add(root);
  else if (openRoots.delete(root)) lastClosed = performance.now();
  // Closed, or handed over to another control (a wrapped trigger, the delegate's next control): let go of ours.
  if (current && current.root === root && (!open || root.api.getPayload() !== current.el)) release();
}

function release() {
  const was = current;
  current = null;
  stopTracking();
  if (!was) return;
  if (was.describedBy === null) was.el.removeAttribute('aria-describedby');
  else if (was.describedBy !== undefined) was.el.setAttribute('aria-describedby', was.describedBy);
}

const warm = () => openRoots.size > 0 || performance.now() - lastClosed < WARM;
const cancelPending = () => { if (pending) clearTimeout(pending.timer); pending = null; };

function show(el, by, event) {
  if (!el.isConnected) return;
  const root = tooltipFor(hostOf(el));
  if (!root.api) { customElements.whenDefined('ui-tooltip').then(() => queueMicrotask(() => { if (root.api && (by !== 'hover' || hovered === el)) show(el, by, event); })); return; }
  if (current?.el === el && root.api.isOpen()) { current.by = by === 'keyboard' ? current.by : by; return; }
  let last = el.getBoundingClientRect();
  // Read on every placement check: a control re-rendered away closes its tooltip instead of pinning it to a corner.
  const anchor = {getBoundingClientRect: () => {
    if (el.isConnected) return (last = el.getBoundingClientRect());
    queueMicrotask(() => { if (current?.el === el) close('imperative'); });
    return last;
  }};
  release();
  current = {el, root, by};
  root.api.open({anchor, payload: el, reason: by === 'hover' ? 'trigger-hover' : 'trigger-focus', event});
  if (current?.el !== el) return;
  if (!root.api.isOpen() || root.api.getPayload() !== el) { current = null; return; }
  openRoots.add(root);
  // Only the control that opened the shared tooltip is described by it (tooltip.md § Shared).
  const id = root.querySelector('ui-tooltip-content')?.id;
  if (id) { current.describedBy = el.getAttribute('aria-describedby'); el.setAttribute('aria-describedby', id); }
}

function close(reason, event) {
  if (!current) return;
  const {root} = current;
  root.api?.close?.({reason, event});
  if (current?.root === root && !root.api?.isOpen?.()) release();
}

function stopTracking() {
  if (tracking) document.removeEventListener('pointermove', tracking, true);
  tracking = null;
}

// The pointer may cross from the control to its tooltip (tooltip.md: "The pointer can leave the trigger sideways on its
// way to the tooltip"). The SDK's rule: the convex hull of both boxes, 4 px out.
function hullOf(a, b) {
  const pts = [a, b].flatMap(r => [{x: r.left - HULL_PAD, y: r.top - HULL_PAD}, {x: r.right + HULL_PAD, y: r.top - HULL_PAD}, {x: r.right + HULL_PAD, y: r.bottom + HULL_PAD}, {x: r.left - HULL_PAD, y: r.bottom + HULL_PAD}]);
  pts.sort((p, q) => p.x - q.x || p.y - q.y);
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const half = list => { const out = []; for (const p of list) { while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); } out.pop(); return out; };
  const hull = [...half(pts), ...half([...pts].reverse())];
  return (x, y) => { for (let i = 0; i < hull.length; i++) { const p = hull[i], q = hull[(i + 1) % hull.length]; if ((q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x) < 0) return false; } return true; };
}

function enter(el, event) {
  if (pressed === el || event.buttons) return;
  cancelPending();
  if (current?.el === el) { stopTracking(); return; }
  if (warm()) { show(el, 'hover', event); return; }
  pending = {el, timer: setTimeout(() => { pending = null; if (hovered === el) show(el, 'hover', event); }, DELAY)};
}

function leave(el, event) {
  if (pending?.el === el) cancelPending();
  if (pressed === el) pressed = null;
  if (current?.el !== el || current.by !== 'hover') return;
  const content = current.root.querySelector('ui-tooltip-content');
  const box = content?.getBoundingClientRect();
  if (!box?.width || !el.isConnected) { close('trigger-hover', event); return; }
  const inside = hullOf(el.getBoundingClientRect(), box);
  if (!inside(event.clientX, event.clientY)) { close('trigger-hover', event); return; }
  stopTracking();
  tracking = move => { if (current?.el !== el) return stopTracking(); if (!inside(move.clientX, move.clientY)) close('trigger-hover', move); };
  document.addEventListener('pointermove', tracking, true);
}

function installDelegate() {
  if (typeof document === 'undefined' || installDelegate.done) return;
  installDelegate.done = true;
  // Input modality, as the SDK keeps it: a key (not a lone modifier) or Tab makes focus "keyboard focus"; a pointer
  // press makes it pointer focus; focus coming back with the window opens nothing until the next key.
  document.addEventListener('keydown', event => {
    windowBlurred = false;
    const modifier = event.metaKey || event.ctrlKey || event.altKey || /^(Meta|Control|Alt|Shift)$/.test(event.key);
    if (event.key === 'Tab' || !modifier) modality = 'keyboard';
    if (current && (event.key === 'Enter' || event.key === ' ') && current.el.contains(event.target)) close('trigger-press', event);
  }, true);
  document.addEventListener('pointerdown', event => {
    modality = 'pointer'; windowBlurred = false;
    const el = delegated(event.target);
    if (!el) return;
    cancelPending();
    if (event.pointerType !== 'touch') pressed = el;
    if (current?.el === el) close('trigger-press', event);
  }, true);
  document.addEventListener('touchstart', () => { modality = 'pointer'; }, {capture: true, passive: true});
  addEventListener('blur', event => { if (event.target === window) windowBlurred = true; });

  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const el = delegated(event.target);
    if (el === hovered) return;
    const was = hovered;
    hovered = el;
    if (was) leave(was, event);
    if (el) enter(el, event);
  }, {passive: true});
  document.addEventListener('pointerout', event => {
    if (event.pointerType === 'touch' || !hovered || event.relatedTarget) return;
    // Left the window (no related target): treat as leaving the control.
    const was = hovered; hovered = null; leave(was, event);
  }, {passive: true});

  document.addEventListener('focusin', event => {
    const el = delegated(event.target);
    // A menu row's hint shows on hover only, as in native menus: arrowing through a menu opens nothing over it.
    if (!el || el !== event.target || modality !== 'keyboard' || windowBlurred || el.closest('[role=menu]')) return;
    show(el, 'keyboard', event);
  });
  document.addEventListener('focusout', event => {
    if (!current || current.el !== event.target || current.by === 'hover') return;
    if (event.relatedTarget && current.root.querySelector('ui-tooltip-content')?.contains(event.relatedTarget)) return;
    close('focus-out', event);
  });
}
installDelegate();
