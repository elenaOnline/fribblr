// Keyboard focus on a board's items, per UI SDK's canvas norms (ui-sdk.md § Surfaces › Board canvas).
//
// The board's cards and drawn elements (text, shapes, regions, arrows, stickers, containers) are one roving group:
// one Tab stop, on the item focused last, with that item's own controls after it in Tab order. Plain arrows move
// focus to the nearest item that way, Option/Alt with an arrow moves the focused item, Space selects, Enter opens.
// A container is a composite item: its members are a group of their own, entered with Enter and left with Escape,
// so the arrows outside a container pass over its members and the arrows inside stay among them.
//
// Built on the board's own pan, drag and data, not on a UI SDK primitive (that would put a part around every card,
// on the paths that must stay cheap); the SDK's standalone Core helpers do the searching and the speaking. Everything
// here runs on key and focus events; nothing runs per card on pan, drag or marquee.
import {decorationBounds} from './whiteboard-geometry.js';
import {containerDropUnchanged} from './containers.js';

// UI SDK Core (nearestInDirection, announce, keepFocus, moveMessage, resizeMessage, reorderMessage). core.js pulls in
// most of the SDK's chunks, so it loads without blocking the board's start; every use is on a key press, long after.
let core = null, coreLoading = null;
export function sdkCore() {
  return coreLoading ||= import('./vendor/ui-sdk/web/core.js').then(module => (core = module));
}
// Say something through the SDK's live region (polite), once Core is in.
export function announce(message, options) {
  if (!message) return;
  if (core) core.announce(message, options);
  else sdkCore().then(module => module.announce(message, options)).catch(() => {});
}

export const ARROWS = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
const ITEMS = '.workspace-card[data-placement], .workspace-decoration[data-decoration]';
const EDITING = 'input,textarea,select,[contenteditable],[role=textbox],[role=dialog]';

// ---- Pure helpers (no DOM) ----

// The roving key of a container child: a string is a drawn element's id, an object a card's placement.
export const childKey = child => typeof child === 'string' ? `decoration:${child}` : `placement:${child?.placementId}`;
export const refOfKey = key => key?.startsWith('placement:') ? {placementId: key.slice(10)} : key?.startsWith('decoration:') ? {decorationId: key.slice(11)} : null;

// Every container member's roving key → {parent (the container decoration), index, count}.
export function containerMembers(board) {
  const members = new Map();
  for (const parent of board?.decorations || []) {
    const children = parent.container?.children;
    if (!children) continue;
    children.forEach((child, index) => members.set(childKey(child), {parent, index, count: children.length}));
  }
  return members;
}

// Where an Option/Alt-arrow takes a container member: the SDK's reorder keys (createReorder: Left/Right one place,
// Up/Down between rows in a grid; a stack along Up/Down, a row along Left/Right) on the move chord, and with Shift to
// either end (the large step). Returns the new index, or null when that arrow does not move along this layout or the
// member is already at that end.
export function reorderIndex({layout = 'vertical', columns = 2} = {}, index, count, [dx, dy], large = false) {
  let target = null;
  const along = layout === 'vertical' ? dy : layout === 'horizontal' ? dx : dx || dy;
  if (!along) return null;
  if (large) target = along < 0 ? 0 : count - 1;
  else if (layout === 'grid' && dy) target = index + dy * Math.max(1, Math.min(columns, count));
  else target = index + along;
  if (target < 0 || target >= count || target === index) return null;
  return target;
}

// A short spoken name for a drawn element, as its card title is for a card.
export function decorationLabel(d) {
  if (!d) return 'Item';
  if (d.sticker) return `Sticker ${d.text || ''}`.trim();
  const text = String(d.text || '').split(/\r?\n/).map(line => line.replace(/^#{1,6} |^- \[[ xX]\] |^[-*] /, '').trim()).find(Boolean)?.slice(0, 80);
  if (d.container) return text || 'Container';
  return text || (d.type === 'line' ? 'Arrow' : d.shape || d.type || 'Item');
}

// ---- The roving group ----
export class BoardFocus {
  constructor(board) {
    this.board = board;
    this.stop = null;          // the roving key of the item that holds the board's Tab stop
    this.inside = new Map();   // container id → the member focused last in it (the SDK's remember: true)
    this.roved = new Map();    // toolbar class → the control focused last in that toolbar of the stop item
    if (typeof window !== 'undefined') sdkCore().catch(() => {});
    // The toolbars inside cards (the hover strip, a stack's version ticker): one delegated listener for the page, on
    // key presses only (registered before the board's own key handlers, which step aside for a toolbar's keys).
    if (typeof document !== 'undefined') document.addEventListener('keydown', e => this.roveKey(e), true);
  }
  world() { return document.getElementById('world'); }
  key(el) {
    if (el?.matches?.('.workspace-card[data-placement]')) return `placement:${el.dataset.placement}`;
    if (el?.matches?.('.workspace-decoration[data-decoration]')) return `decoration:${el.dataset.decoration}`;
    return null;
  }
  item(target) { return target?.closest?.(`#world :is(${ITEMS})`) || null; }
  element(key) {
    const ref = refOfKey(key), world = this.world();
    if (!ref || !world) return null;
    return ref.placementId ? world.querySelector(`.workspace-card[data-placement="${CSS.escape(ref.placementId)}"]`)
      : world.querySelector(`.workspace-decoration[data-decoration="${CSS.escape(ref.decorationId)}"]`);
  }
  tabIndex(key) { return key === this.stop ? 0 : -1; }

  // A card's markup with its place in the group: the stop card is tabbable and keeps its controls in Tab order after
  // it; any other card and its controls leave the Tab order. The preview's big "Open" duplicates the title and the
  // hover toolbar's Open, so it never takes a Tab stop.
  cardMarkup(html, placementId, title) {
    const stop = this.stop === `placement:${placementId}`;
    html = html.replace('<article tabindex="-1"', () => `<article tabindex="${stop ? 0 : -1}" aria-label="${escapeAttr(title || 'Untitled')}"`)
      .replace('<button type="button" class="workspace-preview-launch"', '<button type="button" tabindex="-1" class="workspace-preview-launch"');
    return stop ? html : html.replace(/<(button|a)\b(?![^>]*\btabindex=)/g, '<$1 tabindex="-1"');
  }
  // A drawn element's markup: the root takes the stop's tabindex; inside any other one, its controls (task boxes,
  // links, handles) leave the Tab order. The common case (no controls inside) costs one string replace.
  // A Text block's label scrolls when its text overflows, and Chrome makes such a scroller a Tab stop of its own: it is a
  // control inside the item too, so it is reachable (and scrolls with the arrows) only after the stop.
  decorationMarkup(html, id, {inner = true} = {}) {
    const stop = this.stop === `decoration:${id}`;
    html = html.replace('tabindex="0"', `tabindex="${stop ? 0 : -1}"`);
    if (stop || !inner) return html;
    if (html.includes('decoration-text')) html = html.replace(' data-decoration-label', ' tabindex="-1" data-decoration-label');
    if (!html.includes('<button') && !html.includes('<a ') && !html.includes('tabindex="0"')) return html;
    return html.replace(/tabindex="0"/g, 'tabindex="-1"').replace(/<(button|a)\b(?![^>]*\btabindex=)/g, '<$1 tabindex="-1"');
  }
  // Moves the stop in place: two elements' attributes, no rebuild.
  setStop(key) {
    if (!key || key === this.stop) return;
    const old = this.element(this.stop), next = this.element(key);
    this.stop = key;
    this.roved.clear();
    if (old) {
      old.tabIndex = -1;
      for (const el of old.querySelectorAll('button:not([tabindex]),a[href]:not([tabindex]),[tabindex="0"],.decoration-text > [data-decoration-label]:not([tabindex])')) el.tabIndex = -1;
    }
    if (next) {
      next.tabIndex = 0;
      for (const el of next.querySelectorAll('button[tabindex="-1"]:not(.workspace-preview-launch,[data-roving] *),a[href][tabindex="-1"]:not([data-roving] *)')) el.removeAttribute('tabindex');
      for (const el of next.querySelectorAll('[role=button][tabindex="-1"]')) el.tabIndex = 0;
      next.querySelector(':scope.decoration-text > [data-decoration-label][tabindex="-1"]')?.removeAttribute('tabindex');
      for (const bar of next.querySelectorAll('[data-roving]')) this.roveStop(bar);
    }
    const parent = this.board.snapshot && containerMembers(this.board.snapshot).get(key)?.parent;
    if (parent) this.inside.set(parent.id, key);
  }
  // Before a rebuild: where the focused item was on screen, in case the rebuild removes it. (On screen, not from the
  // snapshot: a deleted drawn element has already left the snapshot the rebuild draws, where a removed card has not.)
  lostBox() {
    const el = this.element(this.stop);
    if (!el || !el.contains(document.activeElement) || !el.getClientRects().length) return null;
    return el.getBoundingClientRect();
  }
  // After a rebuild: the stop still names a rendered item, else the first card (or drawn element) takes it. If the
  // focused item went away (removed, moved into a board, filtered out), focus goes to the item nearest to where it
  // was, as UI SDK's focus recovery does, instead of dropping to the page.
  ensureStop(lost) {
    const kept = this.element(this.stop);
    if (kept) { this.restoreRoving(kept); return; }
    const world = this.world();
    if (!world) return;
    // The first card on the board itself (not inside a container), else the first drawn element there.
    const members = this.board.mode === 'canvas' ? containerMembers(this.board.snapshot) : new Map();
    const top = selector => [...world.querySelectorAll(selector)].find(el => !members.has(this.key(el)));
    let next = top('.workspace-card[data-placement]') || top('.workspace-decoration[data-decoration]');
    if (lost && next) {
      // Nearest on screen: the canvas draws every item at one scale, so this is the nearest on the board too. It runs
      // only when the focused item has just gone.
      const centre = r => [(r.left + r.right) / 2, (r.top + r.bottom) / 2], [x, y] = centre(lost);
      let best = Infinity;
      for (const item of this.items()) {
        if (!item.el.getClientRects().length) continue;
        const [cx, cy] = centre(item.el.getBoundingClientRect()), d = Math.hypot(cx - x, cy - y);
        if (d < best) { best = d; next = item.el; }
      }
    }
    this.stop = null;
    if (!next) return;
    this.setStop(this.key(next));
    if (lost && (!document.activeElement || document.activeElement === document.body)) next.focus({preventScroll: true});
  }
  // ---- Toolbars inside an item ----
  // A card's hover strip (Open | Edit | Comments | Vote | Favorite) and a stack's version ticker (‹ name ›) are toolbars
  // (toolbar.md): one Tab stop, on the control focused last (else the first), ←/→ along it with wrap, Home/End to its
  // ends; a disabled step (aria-disabled) stays reachable, a control that is not rendered (narrow card, no votes yet) is
  // skipped. Built without a ui-toolbar per card (that is an element and a binding per card on the board's cheap
  // paths): the markup marks the toolbar `data-roving` and writes tabindex="-1" on every control but its first; one
  // capture listener for the page handles the keys, and the focusin bookkeeping moves the stop. Nothing runs on render,
  // pan, zoom or drag beyond a rebuild re-asserting the stop item's own toolbars.
  roveControls(bar) {
    return [...bar.querySelectorAll('button,a[href]')].filter(el => !el.disabled && el.getClientRects().length);
  }
  // A stable name for a control across re-renders: its first data-* attribute (data-star="…", data-file-version-step="next").
  roveName(el) {
    const attr = [...el.attributes].find(a => a.name.startsWith('data-') && a.name !== 'data-tip' && !a.name.startsWith('data-tip-'));
    return attr ? `${attr.name}=${attr.value}` : '';
  }
  roveGroup(bar) { return bar.className.split(/\s+/)[0] || 'toolbar'; }
  // Gives `target` (else the control focused last, else the first) the toolbar's Tab stop. Only inside the stop item:
  // every other item's controls are out of the Tab order altogether.
  roveStop(bar, target = null) {
    const all = [...bar.querySelectorAll('button,a[href]')];
    if (!all.length) return;
    const item = this.item(bar), stop = !!item && this.key(item) === this.stop;
    if (!target && stop) {
      const name = this.roved.get(this.roveGroup(bar));
      target = name ? all.find(el => this.roveName(el) === name) : null;
    }
    if (target && (target.disabled || (!bar.contains(document.activeElement) && !target.getClientRects().length))) target = null;
    target ||= all.find(el => !el.disabled) || null;
    for (const el of all) {
      const index = !stop ? -1 : el === target ? 0 : -1;
      if (el.tabIndex !== index || !el.hasAttribute('tabindex')) el.tabIndex = index;
    }
  }
  // focusin: a control inside an item's toolbar takes that toolbar's stop.
  rove(target) {
    const bar = target?.closest?.('#world [data-roving]');
    if (!bar || !this.item(bar)) return;
    this.roved.set(this.roveGroup(bar), this.roveName(target));
    this.roveStop(bar, target);
  }
  // Focus coming to an item checks that each of its toolbars can be reached: a first control that a narrow card hides
  // passes the stop along (one item, on focus only).
  roveReach(item) {
    for (const bar of item?.querySelectorAll?.('[data-roving]') || []) {
      const holder = [...bar.querySelectorAll('button,a[href]')].find(el => el.tabIndex === 0);
      if (holder && !holder.disabled && holder.getClientRects().length) continue;
      const first = this.roveControls(bar)[0];
      if (first && first !== holder) this.roveStop(bar, first);
    }
  }
  // After a rebuild the markup puts the stop item's toolbars back on their first control: the control focused last (or
  // focused now) takes it back, so Tab never lands on a second stop inside the same toolbar.
  restoreRoving(item) {
    if (!this.roved.size) return;
    for (const bar of item.querySelectorAll('[data-roving]')) this.roveStop(bar, bar.contains(document.activeElement) ? document.activeElement.closest('button,a[href]') : null);
  }
  roveKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return false;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowDown'].includes(e.key)) return false;
    const control = e.target?.closest?.('button,a[href]'), bar = control?.closest('#world [data-roving]');
    if (!bar) return false;
    // ↓ on a button that opens something (Vote's ballot) opens it, as a toolbar's menu button does; the version name's
    // menu opens from the board's own key handler (menuKey), which also places it.
    if (e.key === 'ArrowDown') {
      if (e.shiftKey || !control.matches('[aria-haspopup]:not([data-file-version-menu])') || control.getAttribute('aria-disabled') === 'true') return false;
      e.preventDefault(); e.stopImmediatePropagation();
      control.click();
      return true;
    }
    const controls = this.roveControls(bar);
    if (!controls.length) return false;
    const at = controls.indexOf(control), last = controls.length - 1;
    const index = e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowRight' ? (at < 0 ? 0 : at === last ? 0 : at + 1) : (at <= 0 ? last : at - 1);
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat && ((e.key === 'ArrowRight' && at === last) || (e.key === 'ArrowLeft' && at === 0))) return true;
    controls[index].focus({preventScroll: true});
    return true;
  }

  // The rendered items with their boxes: board units on Canvas (from the board's data, no layout read), screen boxes in
  // Grid. `parent` is the container an item belongs to (null on the board itself).
  items() {
    const board = this.board, snapshot = board.snapshot, grid = board.mode !== 'canvas';
    const placements = new Map(snapshot.placements.map(p => [p.id, p]));
    const decorations = new Map((snapshot.decorations || []).map(d => [d.id, d]));
    const members = grid ? new Map() : containerMembers(snapshot);
    const items = [];
    for (const el of this.world().querySelectorAll(ITEMS)) {
      const key = this.key(el);
      let box = null;
      if (grid) { const r = el.getBoundingClientRect(); box = {x: r.left, y: r.top, width: r.width, height: r.height}; }
      else if (el.dataset.placement) box = placements.get(el.dataset.placement) || null;
      else if (decorations.has(el.dataset.decoration)) box = decorationBounds(decorations.get(el.dataset.decoration), snapshot);
      if (!box) continue;
      const member = members.get(key);
      items.push({key, el, box, parent: member?.parent.id ?? null, index: member?.index ?? -1,
        rect: {left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height}});
    }
    return items;
  }
  // The group an item moves in: the board's own items, or one container's members.
  scope(items, parent) { return items.filter(item => item.parent === parent); }
  // Cards first, in their reading order, then drawn elements (they come first in the DOM only to sit below); inside a
  // container, its own order.
  ordered(scope) {
    if (scope[0]?.parent) return [...scope].sort((a, b) => a.index - b.index);
    return [...scope.filter(item => item.el.dataset.placement), ...scope.filter(item => !item.el.dataset.placement)];
  }
  focusItem(item, {reveal = true} = {}) {
    this.setStop(item.key);
    item.el.focus({preventScroll: true});
    if (!reveal) return;
    // The view pans to bring it in (UI SDK viewport: focus-in), in one step.
    if (this.board.mode === 'canvas') this.board.hooks.revealBox?.(item.box);
    else item.el.scrollIntoView?.({block: 'nearest', inline: 'nearest'});
  }
  // Bring an item into view without moving focus (Tab arrived on it).
  revealElement(el) {
    const item = this.items().find(item => item.el === el);
    if (!item) return;
    if (this.board.mode === 'canvas') this.board.hooks.revealBox?.(item.box);
    else el.scrollIntoView?.({block: 'nearest', inline: 'nearest'});
  }
  focusKey(key, options) {
    const item = this.items().find(item => item.key === key);
    if (item) this.focusItem(item, options);
    return !!item;
  }
  label(el) {
    const snapshot = this.board.snapshot;
    if (el?.dataset?.placement) {
      const p = snapshot.placements.find(p => p.id === el.dataset.placement);
      return snapshot.items[p?.itemId]?.title || 'Item';
    }
    return decorationLabel((snapshot.decorations || []).find(d => d.id === el?.dataset?.decoration));
  }

  // ---- Keys. Each returns true when it took the key. ----

  // The board's item keys in order: arrows and Home/End move focus, Space selects, Enter opens or enters, arrows on a
  // resize corner resize, Option/Alt-arrow moves.
  keydown(e) {
    if (e.ctrlKey || e.metaKey) return false;
    return this.focusKeys(e) || this.itemKeys(e) || this.resizeKey(e) || (e.altKey && this.moveKey(e));
  }
  // Plain arrows (Shift too), Home and End on a focused item move focus: arrows to the nearest item that way among the
  // same group (UI SDK nearestInDirection on board units, so zoom never matters and Left is always screen-left), Home
  // and End to its first and last item.
  focusKeys(e) {
    const el = this.item(e.target);
    if (!el || e.target !== el || e.altKey || e.ctrlKey || e.metaKey) return false;
    const direction = ARROWS[e.key];
    if (!direction && e.key !== 'Home' && e.key !== 'End') return false;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!core) {
      const {key, shiftKey} = e;
      sdkCore().then(() => { if (document.activeElement === el) this.focusKeys({key, shiftKey, target: el, preventDefault() {}, stopImmediatePropagation() {}}); });
      return true;
    }
    const items = this.items(), from = items.find(item => item.el === el);
    if (!from) return true;
    const scope = this.scope(items, from.parent);
    let next;
    if (!direction) next = e.key === 'Home' ? this.ordered(scope)[0] : this.ordered(scope).at(-1);
    else {
      const key = core.nearestInDirection(from.rect, scope.filter(item => item !== from), direction);
      next = key && scope.find(item => item.key === key);
    }
    if (next && next !== from) this.focusItem(next);
    return true;
  }
  // Space toggles the focused item's selection, as ⌘/Ctrl-click does (a grouped item brings its group); focus stays
  // (UI SDK: focus is not selection). Enter opens the focused card, and goes into a focused container, onto the member
  // focused last there (else its first). A drawn element's own Enter and F2 stay Whiteboard's (whiteboard.js).
  itemKeys(e) {
    const el = this.item(e.target);
    if (!el || e.target !== el || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    const board = this.board;
    if (e.key === ' ') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (board.hooks.viewOnly) return true;
      const ref = el.dataset.placement ? {placementId: el.dataset.placement} : {decorationId: el.dataset.decoration};
      const group = board.groupForOccurrence?.(ref);
      board.toggleOccurrence(ref);
      const on = ref.placementId ? board.selection.has(ref.placementId)
        : board.activeDecoration === ref.decorationId || board.decorationSelection?.has(ref.decorationId);
      const count = board.selection.size + (board.decorationSelection?.size || (board.activeDecoration ? 1 : 0));
      const what = group ? `Group of ${group.placementIds.length + group.decorationIds.length}` : this.label(el);
      announce(`${what} ${on ? 'selected' : 'deselected'}. ${count} selected.`);
      this.keepOn(this.key(el));
      return true;
    }
    if (e.key === 'Enter' && el.dataset.placement) {
      const open = el.querySelector('[data-open]:not(:disabled):not([data-slot])');
      if (!open) return false;
      e.preventDefault(); e.stopImmediatePropagation();
      open.click();
      return true;
    }
    if (e.key === 'Enter' && el.dataset.decoration && this.enterContainer(el.dataset.decoration)) {
      e.preventDefault(); e.stopImmediatePropagation();
      return true;
    }
    return false;
  }
  // Enter on a container: focus goes in, to the member focused last there, else the first. An empty container has
  // nothing to enter (Enter then keeps Whiteboard's meaning: the container's options).
  enterContainer(id) {
    const parent = (this.board.snapshot.decorations || []).find(d => d.id === id);
    if (!parent?.container?.children?.length || this.board.mode !== 'canvas') return false;
    const items = this.scope(this.items(), id);
    if (!items.length) return false;
    const remembered = items.find(item => item.key === this.inside.get(id));
    const target = remembered || this.ordered(items)[0];
    this.focusItem(target);
    announce(`${decorationLabel(parent)}: ${items.length} ${items.length === 1 ? 'item' : 'items'}. ${this.label(target.el)}. Escape returns to the container.`);
    return true;
  }
  // Escape on a focused container member goes back to the container (after everything else Escape does: popups,
  // gestures, edits, the selection). Called last in the board's Escape ladder.
  escapeKey(e) {
    const el = this.item(e.target);
    if (!el || e.target !== el || this.board.mode !== 'canvas') return false;
    const parent = containerMembers(this.board.snapshot).get(this.key(el))?.parent;
    if (!parent) return false;
    e.preventDefault(); e.stopImmediatePropagation();
    this.inside.set(parent.id, this.key(el));
    this.focusKey(`decoration:${parent.id}`);
    return true;
  }
  // Arrows on a focused card's resize corner move that corner, 1 unit, 10 with Shift (UI SDK createResize keys),
  // within the card's minimum size. One write and one undo step per press; announced.
  resizeKey(e) {
    const handle = e.target.closest?.('#world .workspace-resize[data-resize]');
    const delta = ARROWS[e.key];
    if (!handle || !delta || e.altKey || e.ctrlKey || e.metaKey) return false;
    e.preventDefault(); e.stopImmediatePropagation();
    const board = this.board;
    if (board.pointerGesture || board.keysBusy() || board.hooks.viewOnly) return true;
    const p = board.snapshot.placements.find(entry => entry.id === handle.dataset.resize);
    if (!p || p.removedAt || p.deletedAt) return true;
    const step = e.shiftKey ? 10 : 1;
    const patch = board.resizePlacementBox(p, 'se', delta[0] * step, delta[1] * step);
    if (patch.width === p.width && patch.height === p.height) return true;
    const label = this.label(handle.closest('.workspace-card'));
    board.hooks.holdView?.();
    board.keyMoveRunning(async () => {
      await board.writeArrangement('updatePlacement', {boardId: board.snapshot.id, placementId: p.id, patch}, latest => board.placementsUnchanged(latest, [p]));
      await board.refresh({saveReview: false});
      const sdk = await sdkCore();
      sdk.keepFocus(() => this.world()?.querySelector(`.workspace-resize[data-resize="${CSS.escape(p.id)}"]`));
      sdk.announce(sdk.resizeMessage({label, handle: 'se', box: patch}));
    });
    return true;
  }
  // Option/Alt + arrow moves (UI SDK createMove keys): 1 unit, 10 with Shift. The focused item moves; one that is
  // selected carries the selection with it; a grouped one carries its group (as dragging it does); with nothing
  // focused on the board the selection moves. A container's members flow inside it, so Option-arrow on a member
  // moves it to the next place in the container instead (reorder). Plain arrows never move anything.
  moveKey(e) {
    const delta = ARROWS[e.key];
    if (!delta || !e.altKey || e.ctrlKey || e.metaKey) return false;
    const board = this.board;
    if (board.mode !== 'canvas') return false;
    const el = this.item(e.target);
    const key = el && this.key(el), ref = refOfKey(key);
    const member = key && containerMembers(board.snapshot).get(key);
    if (member) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!board.hooks.viewOnly) this.reorder(el, ref, member, delta, e.shiftKey);
      return true;
    }
    const plan = this.movePlan(ref);
    if (!plan) return false;
    e.preventDefault(); e.stopImmediatePropagation();
    if (board.pointerGesture || board.movePending || board.historyBusy || board.hooks.viewOnly) return true;
    const [dx, dy] = delta.map(v => v * (e.shiftKey ? 10 : 1));
    const focus = el && el.contains(document.activeElement) ? key : null;
    board.keyMoveRunning(async () => {
      const moved = await board.translateOccurrences({...plan, dx, dy});
      if (!moved) return;
      const sdk = await sdkCore();
      if (focus) sdk.keepFocus(() => this.element(focus));
      sdk.announce(sdk.moveMessage(moved));
    });
    return true;
  }
  // What an Option-arrow moves, from the focused item's ref (or null with nothing focused).
  movePlan(ref) {
    const board = this.board, snapshot = board.snapshot;
    const live = snapshot.placements.filter(p => !p.removedAt && !p.deletedAt);
    const drawn = snapshot.decorations || [];
    const selected = () => ({placements: live.filter(p => board.selection.has(p.id)), decorations: board.keyboardDecorations()});
    const groupOf = r => board.groupForOccurrence?.(r);
    const fromGroup = group => ({placements: live.filter(p => group.placementIds.includes(p.id)), decorations: drawn.filter(d => group.decorationIds.includes(d.id))});
    let plan;
    if (ref?.placementId) {
      if (board.selection.has(ref.placementId)) plan = selected();
      else if (groupOf(ref)) plan = fromGroup(groupOf(ref));
      else plan = {placements: live.filter(p => p.id === ref.placementId), decorations: []};
    } else if (ref?.decorationId) {
      const d = drawn.find(entry => entry.id === ref.decorationId);
      if (board.keyboardDecorations().some(entry => entry.id === ref.decorationId)) plan = selected();
      else if (board.activeDecoration !== ref.decorationId && groupOf(ref)) plan = fromGroup(groupOf(ref));
      else plan = d ? {single: d} : null;
    } else if (board.keyboardDecorations().length) plan = selected();
    else if (board.activeDecoration) plan = {single: drawn.find(d => d.id === board.activeDecoration)};
    else plan = selected();
    if (!plan || (!plan.single && !plan.placements.length && !plan.decorations.length)) return null;
    plan.focus = ref;
    return plan;
  }
  // Option-arrow on a container member: it takes the next place along the container's layout, or with Shift the first
  // or last place. One moveContainerMember write (one undo step); announced with the SDK's reorder wording.
  reorder(el, ref, member, delta, large) {
    const board = this.board, {parent, index, count} = member;
    const target = reorderIndex(parent.container, index, count, delta, large);
    if (target === null) {
      announce(`${this.label(el)}, position ${index + 1} of ${count}.`);
      return;
    }
    if (board.pointerGesture || board.movePending || board.historyBusy || board.keysBusy()) return;
    const key = this.key(el), label = this.label(el);
    board.keyMoveRunning(async () => {
      await board.writeArrangement('moveContainerMember', {boardId: board.snapshot.id, member: ref, containerId: parent.id, index: target},
        containerDropUnchanged(board.snapshot, ref, [parent]));
      await board.refresh({saveReview: false});
      const sdk = await sdkCore();
      sdk.keepFocus(() => this.element(key));
      sdk.announce(sdk.reorderMessage({type: 'drop', label, count: 1, position: target + 1, total: count}));
    });
  }
  // Keeps focus on an item whose element a selection change re-rendered.
  keepOn(key) {
    if (!key) return;
    const back = () => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      this.element(key)?.focus({preventScroll: true});
    };
    back(); requestAnimationFrame(back);
  }
  // Escape in the selection bar clears the selection and the bar goes. The bar is hidden now, so focus is still inside
  // it or already on <body>: it goes to the board's roving item (the one focused last); with none yet (selected with ⌘A
  // or the pointer, never Tabbed to an item) the first card takes it, and a board with no items gets the canvas.
  afterBar() {
    const back = () => {
      this.ensureStop(null);
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected && !active.closest('#workspace-selection')) return;
      (this.element(this.stop) || document.getElementById('viewport'))?.focus({preventScroll: true});
    };
    back(); requestAnimationFrame(back);
  }
  // A held arrow keeps moving focus across the board; nothing else repeats.
  repeatKey(e) {
    if (e.target.closest?.(EDITING)) return false;
    return this.focusKeys(e);
  }
}

function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
}

