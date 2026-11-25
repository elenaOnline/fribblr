// Pointing mode: type a message to the agent and point at the board while typing (team/pointing/BRIEF.md).
//
// P (or the rail's Point and type key) enters; Escape or the bar's ✕ leaves. While on, a composer floats where the
// tools were, keys keep going to it, and a sheet over the board takes every press, so pointing never moves, selects or
// edits anything: the gesture ends as a numbered mark on the board and a numbered chip at the caret. Wheel and pinch
// still pan and zoom (the sheet sits inside #viewport, so they reach the board's own handlers); a middle-button drag
// pans, and so does a drag with the Point tool. Leaving puts the view back where it was; selection and panels were
// never touched. Send posts one feedback thread to the agent (CONTRACT.md): body with "@N label" chips, flat refs,
// a point anchor at the first mark and the `pointing` record. The draft (words and marks) survives leaving.
//
// Tools (⌥ + letter, so they work while typing; the tooltip shows the keys):
//   Marquee ⌥M  drag a box; a click points at the thing under it
//   Lasso   ⌥L  drag a free shape, closed on release; a click points
//   Laser   ⌥K  a red dot instead of the cursor; drag to draw a trail that fades behind you. A circle drawn around
//               something is a reference; waving, underlining and passes over things are not. A click points.
//   Point   ⌥P  click a thing (a small one whole, a big one at the spot clicked); drag pans
// Keyboard: @ in the composer picks an item, drawn element or board by name (tool "keyboard").
import {pointingGuard} from './pointing-guard.js';
import {rectHits, pathHits, pointTarget, simplify, boundsOf, closedLoop} from './pointing-geometry.js';
import {esc, attachPicker, decorationLabel} from './comment-refs.js';
import {choiceHTML, setChoice, onChoose} from './ui-toolbar.js';
import {tips} from './tips.js';
import {inPopup} from './popups.js';
import {kindOf} from './kinds.js';
import {pointAnchorAt} from './feedback-geometry.js';
import {toast} from './toasts.js';

const TOOLS = [
  {id: 'marquee', label: 'Marquee', code: 'KeyM', keys: 'Alt+M', icon: '<rect x="3.5" y="4.5" width="13" height="11" rx="1" stroke-dasharray="2.4 2"/>'},
  {id: 'lasso', label: 'Lasso', code: 'KeyL', keys: 'Alt+L', icon: '<path d="M6.5 14.5C3.6 13.4 2.6 10.7 3.6 8.3 4.9 5.3 9 3.6 12.8 4.6c3.4.9 4.6 3.8 3 6.3-1.4 2.2-4.6 3.3-7.6 2.8"/><path d="M8.3 13.6c-.6 1.3-.3 2.6.9 3.1"/>'},
  {id: 'laser', label: 'Laser pointer', code: 'KeyK', keys: 'Alt+K', icon: '<circle cx="13.5" cy="6.5" r="2.2" fill="currentColor" stroke="none"/><path d="M3.5 16.5c2.6-.6 4.4-2.2 5.6-4.4" stroke-dasharray="1.6 1.8"/>'},
  {id: 'point', label: 'Point', code: 'KeyP', keys: 'Alt+P', icon: '<path d="M5 3.5 14.5 9l-4.2 1-2.1 4.3z"/>'},
];
const ICON = {
  enter: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 2.5 11 6.8l-3.3.8-1.6 3.3z"/><path d="M10.5 11.5h6.5v4.2h-3.3l-2 1.8v-1.8h-1.2z"/></svg>',
  close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9"/></svg>',
};
const STORE = 'tinka/pointing-tool';
const PLACEHOLDER = 'Message to the agent. Point at things as you type.';
const CROP_NOTE = 'No crop: this version records what was pointed at and where, not pixels.';
const ROUND = v => Math.round(v * 10) / 10;
const clip = (text, n) => { text = String(text || '').replace(/\s+/g, ' ').trim(); return text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text; };
const TYPING = /^(insert|delete|history)/;
const FIELD = 'input,textarea,select,[contenteditable="true"],[contenteditable=""]';

// ---- where words come from ----
// The words of a message come from a source; typing is the first, voice will be another. A source answers, for each
// stretch of words between two marks, when its first and last word arrived (ms from the message start). A stretch is
// keyed by the mark before it ('' for the start), so moving or renumbering marks never loses the times.
export class TypedWords {
  constructor() { this.times = new Map(); }
  note(key, t) { const span = this.times.get(key); if (span) span.end = t; else this.times.set(key, {at: t, end: t}); }
  span(key) { return this.times.get(key) || null; }
  clear() { this.times.clear(); }
}

export function mountPointing(board) {
  if (board.hooks.viewOnly || board.pointing) return board.pointing;
  board.pointing = new PointingMode(board);
  return board.pointing;
}

class PointingMode {
  constructor(board) {
    this.board = board;
    this.active = false;
    this.marks = new Map();        // id -> mark (kept after its chip is deleted, so Undo can bring it back)
    this.nextN = 1;
    this.t0 = null; this.startedAt = null;
    this.words = new TypedWords();
    this.gesture = null; this.hover = null; this.trail = [];
    try { this.tool = TOOLS.some(t => t.id === localStorage.getItem(STORE)) ? localStorage.getItem(STORE) : 'marquee'; } catch { this.tool = 'marquee'; }
    this.viewport = document.getElementById('viewport');
    this.world = document.getElementById('world');
    this.ensureStyle();
    this.buildBar(); this.buildSheet(); this.buildLayer(); this.addEntry();
    // P enters from the board (Adding a shortcut, ui-sdk.md § 3): never in a field or a menu, never with a modifier.
    document.addEventListener('keydown', e => {
      if (this.active || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key.toLowerCase() !== 'p' || e.isComposing) return;
      if (inPopup(e) || board.boardCommandBlocked?.(e) || board.mode !== 'canvas') return;
      e.preventDefault(); e.stopImmediatePropagation(); this.enter();
    }, true);
    this.onGuard = event => this.guard(event);
  }
  ensureStyle() {
    for (const href of ['/app/comment-thread.css', '/app/pointing.css']) {
      if (document.querySelector(`link[href="${href}"]`)) continue;
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; document.head.append(link);
    }
  }

  // ---------- the composer ----------
  buildBar() {
    const bar = this.bar = document.createElement('section');
    bar.className = 'pointing-bar'; bar.hidden = true; bar.dataset.height = 'float';
    bar.setAttribute('aria-label', 'Point and type');
    bar.innerHTML = `${choiceHTML({label: 'Pointing tool', className: 'pointing-tools', value: this.tool,
      items: TOOLS.map(t => ({value: t.id, ariaLabel: t.label, tip: t.label, className: 'tk-btn tk-icon', attrs: {'aria-keyshortcuts': t.keys, 'data-pointing-tool': t.id},
        html: `<svg viewBox="0 0 20 20" aria-hidden="true">${t.icon}</svg>`}))})}
      <div class="pointing-field-wrap" data-tip-zone><div class="pointing-field" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message to the agent" data-height="sunken" data-placeholder="${PLACEHOLDER}"></div></div>
      <button type="button" class="tk-btn tk-primary pointing-send" data-height="raised" aria-keyshortcuts="Enter">Send</button>
      <button type="button" class="tk-btn tk-icon pointing-leave" data-height="raised" aria-label="Leave pointing" aria-keyshortcuts="Escape" data-tip="Leave pointing">${ICON.close}</button>`;
    document.body.append(bar);
    this.field = bar.querySelector('.pointing-field');
    this.tools = bar.querySelector('.pointing-tools');
    onChoose(this.tools, tool => this.setTool(tool || this.tool));
    bar.querySelector('.pointing-send').addEventListener('click', () => this.send());
    bar.querySelector('.pointing-leave').addEventListener('click', () => this.leave());
    // A press on the bar's keys keeps the caret in the composer.
    bar.addEventListener('mousedown', e => { if (e.target.closest('button') && document.activeElement === this.field) e.preventDefault(); });
    this.picker = attachPicker(this.field, this.board, {onChange: () => this.adoptPicked()});
    this.field.addEventListener('input', e => this.typed(e));
    this.field.addEventListener('paste', e => { // plain text only, so a pasted chip can never be a mark without data
      e.preventDefault(); document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
    });
    document.addEventListener('selectionchange', () => {
      const s = getSelection();
      if (this.active && s.rangeCount && this.field.contains(s.anchorNode)) this.caret = s.getRangeAt(0).cloneRange();
    });
    tips(bar);
    this.syncTool();
  }
  focusField() {
    const s = getSelection();
    // Focused already: the live selection is the caret (selectionchange arrives late, so the kept one can lag a key).
    if (document.activeElement === this.field && s.rangeCount && this.field.contains(s.anchorNode)) return;
    this.field.focus({preventScroll: true});
    if (this.caret && this.field.contains(this.caret.startContainer)) { s.removeAllRanges(); s.addRange(this.caret); }
    else if (!s.rangeCount || !this.field.contains(s.anchorNode)) { const r = document.createRange(); r.selectNodeContents(this.field); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
  }
  setTool(tool) {
    if (!TOOLS.some(t => t.id === tool)) return;
    this.cancelGesture();
    this.tool = tool;
    try { localStorage.setItem(STORE, tool); } catch {}
    this.syncTool();
  }
  syncTool() {
    setChoice(this.tools, this.tool);
    // The chosen tool is a raised key that is on (depth.css); the others are quiet, as on the canvas tools rail.
    for (const b of this.tools.querySelectorAll('[data-pointing-tool]')) {
      if (b.dataset.pointingTool === this.tool) b.dataset.height = 'raised'; else delete b.dataset.height;
    }
    if (this.sheet) { this.sheet.dataset.tool = this.tool; this.hover = null; this.draw(); }
  }

  // ---------- the sheet over the board ----------
  buildSheet() {
    const sheet = this.sheet = document.createElement('canvas');
    sheet.className = 'pointing-sheet'; sheet.hidden = true; sheet.setAttribute('aria-hidden', 'true');
    this.viewport.append(sheet);
    this.ctx = sheet.getContext('2d');
    new ResizeObserver(() => { if (this.active) this.sizeSheet(); }).observe(this.viewport);
  }
  sizeSheet() {
    const r = this.viewport.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    this.sheetRect = r;
    Object.assign(this.sheet.style, {left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`});
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (this.sheet.width !== w || this.sheet.height !== h) { this.sheet.width = w; this.sheet.height = h; }
    this.dpr = dpr;
    this.draw();
  }
  // Board <-> screen. One layout read per frame or press: #world's box and the zoom.
  view() {
    const w = this.world.getBoundingClientRect(), o = this.board.origin || {x: 0, y: 0};
    return {left: w.left, top: w.top, zoom: this.board.hooks.zoom?.() || 1, ox: o.x, oy: o.y};
  }
  toBoard(x, y, v = this.view()) { return {x: (x - v.left) / v.zoom - v.ox, y: (y - v.top) / v.zoom - v.oy}; }
  toScreen(x, y, v) { return [v.left + (x + v.ox) * v.zoom - this.sheetRect.left, v.top + (y + v.oy) * v.zoom - this.sheetRect.top]; }

  // What can be pointed at, as rendered now, in board units.
  candidates(v = this.view()) {
    const snap = this.board.snapshot, out = [];
    const box = el => { const r = el.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return null; const a = this.toBoard(r.left, r.top, v); return {x: a.x, y: a.y, w: r.width / v.zoom, h: r.height / v.zoom}; };
    for (const el of this.world.querySelectorAll('.workspace-card[data-placement]')) {
      const p = snap.placements.find(x => x.id === el.dataset.placement); if (!p) continue;
      const b = box(el); if (!b) continue;
      out.push({...b, key: `placement:${p.id}`, kind: 'placement', id: p.id, placement: p, item: snap.items?.[p.itemId], el});
    }
    for (const el of this.world.querySelectorAll('.workspace-decoration[data-decoration]')) {
      const d = (snap.decorations || []).find(x => x.id === el.dataset.decoration); if (!d) continue;
      const b = box(el); if (!b) continue;
      out.push({...b, key: `decoration:${d.id}`, kind: 'decoration', id: d.id, decoration: d, el,
        line: d.type === 'line', frame: d.type === 'region' && !d.sticker && (!!d.container || !d.shape)});
    }
    return out;
  }
  // The thing under a screen point: the topmost card or drawn element the page hit-tests there.
  thingAt(x, y, list) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === this.sheet || this.bar.contains(el)) continue;
      const hit = el.closest?.('#world .workspace-card[data-placement], #world .workspace-decoration[data-decoration]');
      if (hit) { const key = hit.dataset.placement ? `placement:${hit.dataset.placement}` : `decoration:${hit.dataset.decoration}`; return list.find(c => c.key === key) || null; }
      if (el === this.viewport) break;
    }
    return null;
  }
  target(t) {
    const c = t.candidate, boardId = this.board.snapshot.id;
    if (c.kind === 'placement') {
      const item = c.item;
      return {kind: 'placement', id: c.id, boardId, ...(item?.id ? {itemId: item.id} : {}), itemKind: kindOf(item), title: clip(item?.title || 'Untitled', 120),
        whole: t.whole, ...(t.region ? {region: t.region} : {})};
    }
    const d = c.decoration;
    const itemKind = d.type === 'line' ? 'line' : d.type === 'text' ? 'text' : d.sticker ? 'sticker' : d.type !== 'region' ? d.type || 'drawing'
      : d.container ? 'container' : d.shape === 'rectangle' ? 'sticky' : d.shape ? 'shape' : 'region';
    return {kind: 'decoration', id: c.id, boardId, itemKind, title: clip(d.sticker ? `Sticker ${d.text || ''}` : decorationLabel(d), 120), whole: t.whole, ...(t.region ? {region: t.region} : {})};
  }

  // ---------- entering and leaving ----------
  enter() {
    if (this.active || this.board.mode !== 'canvas' || document.querySelector('#reader-dialog[open]')) return;
    this.active = true; this.sent = null;
    this.boardId = this.board.snapshot.id;
    this.savedView = this.board.hooks.currentView?.() || null;
    this.returnFocus = document.activeElement;
    document.body.classList.add('pointing-on');
    this.bar.hidden = false; this.sheet.hidden = false; this.layer.hidden = false;
    this.hoverList = null; this.hover = null;
    this.sizeSheet(); this.renderMarks();
    pointingGuard.handler = this.onGuard;
    this.focusField();
    this.announce('Pointing on. Type your message and point at the board; Escape leaves.');
  }
  leave() {
    if (!this.active) return;
    this.cancelGesture();
    this.picker?.close();
    this.active = false;
    pointingGuard.handler = null;
    document.body.classList.remove('pointing-on');
    this.bar.hidden = true; this.sheet.hidden = true; this.layer.hidden = true;
    this.hover = null; this.trail = [];
    const v = this.savedView, now = this.board.hooks.currentView?.();
    if (v && now && this.board.snapshot.id === this.boardId && (Math.abs(v.zoom - now.zoom) > 1e-6 || Math.abs(v.x - now.x) > .5 || Math.abs(v.y - now.y) > .5)) this.board.hooks.restoreView?.(v);
    const back = this.returnFocus;
    if (back?.isConnected && back !== document.body) back.focus({preventScroll: true});
    else this.viewport.focus({preventScroll: true});
    this.announce('Pointing off.');
  }
  announce(text) {
    const live = document.getElementById('view-announce'); if (live) live.textContent = text;
  }

  // ---------- the guard: every press on the sheet and the keys the mode owns ----------
  guard(e) {
    if (!this.active) return false;
    if (this.board.snapshot.id !== this.boardId || this.board.mode !== 'canvas') { this.leave(); return false; }
    if (e.type === 'keydown') return this.key(e);
    const onSheet = e.target === this.sheet;
    if (!onSheet) return false;
    if (e.type === 'pointerdown') this.down(e);
    else if (e.type === 'pointermove') this.move(e);
    else if (e.type === 'pointerup') this.up(e);
    else if (e.type === 'pointercancel') this.cancelGesture();
    else e.preventDefault(); // mousedown, click, dblclick, contextmenu: nothing of the board's
    return true;
  }
  key(e) {
    if (e.isComposing || e.keyCode === 229) return false;
    const inField = this.field.contains(e.target), inBar = this.bar.contains(e.target);
    // Tools: ⌥ + letter, by key position (⌥M types µ on a Mac), from anywhere.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat) {
      const tool = TOOLS.find(t => t.code === e.code);
      if (tool) { e.preventDefault(); this.setTool(tool.id); return true; }
    }
    if (e.key === 'Escape') {
      if (this.gesture) { e.preventDefault(); this.cancelGesture(); return true; }
      if (this.picker?.open) { e.preventDefault(); this.picker.close(); return true; }
      if (inPopup(e)) return false;
      if (!inField && !inBar && e.target.closest?.('[role=dialog],dialog,.calm-side,.board-map,.feedback-panel')) return false;
      e.preventDefault(); this.leave(); return true;
    }
    if (inField) {
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !this.picker?.open) { e.preventDefault(); this.send(); return true; }
      return false;
    }
    if (inBar) {
      // The bar's own keys keep Tab, arrows, Space and Enter; anything else is typing, and goes to the composer.
      if (['Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || e.ctrlKey || e.metaKey) return false;
      this.focusField(); return true;
    }
    // Focus elsewhere: in a panel, menu, dialog or field it stays theirs; on the board, keys go to the composer and
    // never to the board's own shortcuts (Delete, ⌘Z, letters).
    if (inPopup(e) || e.target.closest?.(`${FIELD},[role=dialog],dialog,[role=menu],[role=listbox],.calm-side,.board-map,ui-popover-content,.feedback-panel`)) return false;
    if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Control') return false;
    if ((e.metaKey || e.ctrlKey) && ['d', 'g', 'i', 'k'].includes(e.key.toLowerCase())) e.preventDefault();
    this.focusField(); return true;
  }

  // ---------- gestures ----------
  stamp(t = performance.now()) {
    if (this.t0 == null) { this.t0 = t; this.startedAt = new Date(Date.now() - (performance.now() - t)).toISOString(); }
    return Math.max(0, Math.round(t - this.t0));
  }
  down(e) {
    e.preventDefault(); // keeps focus in the composer, and no text selection
    if (this.gesture) return;
    try { this.sheet.setPointerCapture(e.pointerId); } catch {}
    const v = this.view(), p = this.toBoard(e.clientX, e.clientY, v);
    const pan = e.button === 1 || (e.button === 0 && this.tool === 'point');
    if (e.button !== 0 && !pan) return;
    this.gesture = {id: e.pointerId, tool: this.tool, pan, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY,
      start: p, at: this.stamp(e.timeStamp), moved: false, points: [[p.x, p.y]], list: pan ? null : this.candidates(v), loop: [[e.clientX, e.clientY, e.timeStamp]]};
    if (this.tool === 'laser' && !pan) this.trail = [[e.clientX, e.clientY, e.timeStamp]];
    this.sheet.classList.toggle('pointing-panning', pan && this.tool !== 'point' || false);
  }
  move(e) {
    const g = this.gesture;
    this.pointer = {x: e.clientX, y: e.clientY};
    if (!g || g.id !== e.pointerId) {
      if (this.tool === 'point' || this.tool === 'laser' || this.tool === 'marquee' || this.tool === 'lasso') this.hoverAt(e.clientX, e.clientY);
      return;
    }
    const coalesced = e.getCoalescedEvents?.(), events = coalesced?.length ? coalesced : [e];
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 4) { g.moved = true; if (g.pan) this.sheet.classList.add('pointing-panning'); }
    if (g.pan) {
      if (g.moved) this.board.hooks.shiftViewport?.(e.clientX - g.lastX, e.clientY - g.lastY);
      g.lastX = e.clientX; g.lastY = e.clientY;
      return;
    }
    const v = this.view();
    if (g.tool === 'lasso') for (const ev of events) { const p = this.toBoard(ev.clientX, ev.clientY, v); g.points.push([p.x, p.y]); }
    else if (g.tool === 'laser') {
      for (const ev of events) {
        const p = [ev.clientX, ev.clientY, ev.timeStamp];
        this.trail.push(p); g.loop.push(p);
        // Detection keeps its own copy of the trail: a closed circle starts a fresh one, the drawn trail fades as drawn.
        const loop = g.moved && closedLoop(g.loop);
        if (loop) { this.circled(loop, ev.timeStamp, v); g.loop = [p]; }
      }
    }
    g.current = this.toBoard(e.clientX, e.clientY, v);
    this.schedule();
  }
  up(e) {
    const g = this.gesture; if (!g || g.id !== e.pointerId) return;
    this.gesture = null;
    this.sheet.classList.remove('pointing-panning');
    try { this.sheet.releasePointerCapture(e.pointerId); } catch {}
    const end = this.stamp(e.timeStamp);
    if (g.pan) { if (!g.moved && this.tool === 'point' && e.button === 0) this.pointAt(e.clientX, e.clientY, g.at, end, 'point'); this.schedule(); return; }
    if (!g.moved) { this.pointAt(e.clientX, e.clientY, g.at, end, g.tool); this.schedule(); return; }
    const v = this.view();
    if (g.tool === 'marquee') {
      const a = g.start, b = this.toBoard(e.clientX, e.clientY, v);
      const rect = {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y)};
      const hits = rectHits(rect, g.list);
      this.addMark({tool: 'marquee', at: g.at, end, shape: {kind: 'rect', x: ROUND(rect.x), y: ROUND(rect.y), w: ROUND(rect.w), h: ROUND(rect.h)}, hits, empty: 'Board area'});
    } else if (g.tool === 'lasso') {
      const points = simplify(g.points, 1 / v.zoom, 400);
      if (points.length >= 3 && boundsOf(points).w * v.zoom + boundsOf(points).h * v.zoom > 12) {
        this.addMark({tool: 'lasso', at: g.at, end, shape: {kind: 'path', points: points.map(([x, y]) => [ROUND(x), ROUND(y)])}, hits: pathHits(points, g.list), empty: 'Board area'});
      } else this.pointAt(e.clientX, e.clientY, g.at, end, 'lasso');
    }
    // The laser leaves no mark of its own on release: only its circles count; its trail fades.
    this.schedule();
  }
  cancelGesture() {
    if (!this.gesture) return;
    try { this.sheet.releasePointerCapture(this.gesture.id); } catch {}
    this.gesture = null; this.sheet?.classList.remove('pointing-panning');
    this.schedule();
  }
  // A circle the laser drew: what it encloses is a reference (lasso rules). Circling the same thing again at once
  // is emphasis, not a second reference.
  circled({loop}, t, v) {
    const g = this.gesture;
    const points = simplify(loop.map(([x, y]) => { const p = this.toBoard(x, y, v); return [p.x, p.y]; }), 1 / v.zoom, 400);
    const hits = pathHits(points, g.list), keys = hits.targets.map(h => h.candidate.key).sort().join(' ');
    const last = this.lastLaser;
    if (last && last.keys === keys && keys && t - last.t < 2500) { last.t = t; return; }
    this.lastLaser = {keys, t};
    this.addMark({tool: 'laser', at: g.at, end: this.stamp(t), shape: {kind: 'path', points: points.map(([x, y]) => [ROUND(x), ROUND(y)])}, hits, empty: 'Board area'});
    g.at = this.stamp(t);
  }
  // A click: the thing under the pointer, or the board at that spot.
  pointAt(x, y, at, end, tool) {
    const v = this.view(), list = this.candidates(v), p = this.toBoard(x, y, v), hit = this.thingAt(x, y, list);
    const targets = hit ? [pointTarget(hit, p, {zoom: v.zoom})] : [];
    this.addMark({tool, at, end, shape: {kind: 'point', x: ROUND(p.x), y: ROUND(p.y)}, hits: {targets, more: 0}, empty: 'Board point'});
  }
  hoverAt(x, y) {
    if (this.tool === 'laser') { this.schedule(); return; }
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      if (!this.active || this.gesture || !this.pointer) return;
      const v = this.view(), hit = this.thingAt(this.pointer.x, this.pointer.y, this.hoverList ||= this.candidates(v));
      const key = hit?.key || null;
      if (key !== this.hover?.key) { this.hover = hit; this.draw(v); }
    });
  }

  // ---------- marks and chips ----------
  addMark({tool, at, end, shape, hits, empty}) {
    const targets = hits.targets.map(t => this.target(t));
    const n = this.nextN++;
    const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const label = targets.length === 0 ? empty : targets.length === 1 && !hits.more ? targets[0].title : `${targets.length + hits.more} items`;
    const mark = {id, n, tool, at, end: Math.max(at, end), boardId: this.board.snapshot.id, shape, targets, more: hits.more, label};
    this.marks.set(id, mark);
    this.hoverList = null;
    this.insertChip(mark);
    this.renderMarks();
    this.announce(`${n}: ${describe(mark)}`);
    return mark;
  }
  chipHTML(mark) {
    return `<span class="cref pointing-chip" contenteditable="false" data-mark="${mark.id}" data-tip="${esc(describe(mark))}"><b class="pointing-n">${mark.n}</b><span class="cref-label">${esc(clip(mark.label, 32))}</span></span>`;
  }
  insertChip(mark) {
    this.focusField();
    const s = getSelection(), r = s.rangeCount ? s.getRangeAt(0) : null;
    let before = '';
    if (r) { const pre = document.createRange(); pre.selectNodeContents(this.field); pre.setEnd(r.startContainer, r.startOffset); before = pre.toString().slice(-1); }
    const lead = before && !/\s/.test(before) ? ' ' : '';
    this.inserting = true;
    // insertHTML keeps the chip in the composer's own undo history (⌘Z takes back the last pointing); Chrome leaves
    // the caret before a non-editable inline it inserted, so the caret is put after the chip's space here.
    try { document.execCommand('insertHTML', false, `${lead}${this.chipHTML(mark)} `); } finally { this.inserting = false; }
    const chip = this.field.querySelector(`[data-mark="${mark.id}"]`);
    if (!chip) { this.field.insertAdjacentHTML('beforeend', `${lead}${this.chipHTML(mark)} `); }
    const placed = this.field.querySelector(`[data-mark="${mark.id}"]`), after = placed?.nextSibling;
    const c = document.createRange();
    if (after?.nodeType === 3 && after.nodeValue.startsWith(' ')) c.setStart(after, 1); else c.setStartAfter(placed);
    c.collapse(true);
    const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(c); this.caret = c.cloneRange();
  }
  // A chip the @ picker inserted becomes a mark made by the keyboard.
  adoptPicked() {
    const v = this.view(), list = this.candidates(v);
    for (const chip of this.field.querySelectorAll('.cref[data-ref]:not([data-mark])')) {
      let ref; try { ref = JSON.parse(chip.dataset.ref); } catch { chip.remove(); continue; }
      const key = ref.kind === 'item' ? `placement:${ref.placementId || (this.board.snapshot.placements.find(p => p.itemId === ref.id && !p.removedAt)?.id)}` : `${ref.kind}:${ref.id}`;
      let c = list.find(x => x.key === key);
      if (!c && ref.kind === 'board') c = list.find(x => x.item?.childBoardId === ref.id);
      const t = this.stamp(), n = this.nextN++, id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const centre = this.toBoard(this.sheetRect.left + this.sheetRect.width / 2, this.sheetRect.top + this.sheetRect.height / 2, v);
      const targets = c ? [this.target({candidate: c, whole: true})]
        : ref.kind === 'board' ? [{kind: 'board', id: ref.id, boardId: this.board.snapshot.id, itemKind: 'board', title: clip(ref.label, 120), whole: true}] : [];
      const shape = c ? {kind: 'rect', x: ROUND(c.x), y: ROUND(c.y), w: ROUND(c.w), h: ROUND(c.h)} : {kind: 'point', x: ROUND(centre.x), y: ROUND(centre.y)};
      const mark = {id, n, tool: 'keyboard', at: t, end: t, boardId: this.board.snapshot.id, shape, targets, more: 0, label: targets[0]?.title || ref.label || 'Board point'};
      this.marks.set(id, mark);
      const tpl = document.createElement('template'); tpl.innerHTML = this.chipHTML(mark);
      chip.replaceWith(tpl.content.firstElementChild);
    }
    this.renderMarks();
  }
  chips() { return [...this.field.querySelectorAll('.pointing-chip[data-mark]')].filter(c => this.marks.has(c.dataset.mark)); }
  typed(e) {
    if (this.field.dataset.placeholder !== PLACEHOLDER) this.field.dataset.placeholder = PLACEHOLDER;
    if (!this.inserting && TYPING.test(e.inputType || 'insert')) {
      const t = this.stamp(e.timeStamp), s = getSelection();
      let key = '';
      if (s.rangeCount && this.field.contains(s.anchorNode)) {
        const pre = document.createRange(); pre.selectNodeContents(this.field); pre.setEnd(s.anchorNode, s.anchorOffset);
        key = [...pre.cloneContents().querySelectorAll('.pointing-chip[data-mark]')].at(-1)?.dataset.mark || '';
      }
      this.words.note(key, t);
    }
    // Chips deleted (Backspace) or brought back (Undo): the board shows the marks of the chips present.
    this.renderMarks();
    if (!this.chips().length && !this.field.textContent.trim()) { this.nextN = 1; }
  }

  // ---------- drawing ----------
  buildLayer() {
    this.layer = document.createElement('div');
    this.layer.className = 'pointing-marks'; this.layer.hidden = true; this.layer.setAttribute('aria-hidden', 'true');
    this.world.append(this.layer);
    // The board's render replaces #world's children; the layer comes back after each one.
    new MutationObserver(() => { if (this.layer.parentNode !== this.world) this.world.append(this.layer); }).observe(this.world, {childList: true});
  }
  // Marks on the board, in world units (they pan and zoom with it); numbers and strokes keep their screen size.
  renderMarks(sent = this.sent) {
    const marks = sent ? sent.marks : this.chips().map(c => this.marks.get(c.dataset.mark));
    const o = this.board.origin || {x: 0, y: 0};
    let svg = '', badges = '';
    for (const m of marks) {
      const s = m.shape, focus = sent && sent.focus === m.n ? ' pointing-focus' : '';
      let bx, by;
      if (s.kind === 'rect') { svg += `<rect class="pointing-shape${focus}" x="${s.x + o.x}" y="${s.y + o.y}" width="${s.w}" height="${s.h}"/>`; bx = s.x; by = s.y; }
      else if (s.kind === 'path') { svg += `<path class="pointing-shape${focus}" d="M${s.points.map(([x, y]) => `${x + o.x} ${y + o.y}`).join('L')}Z"/>`; const top = s.points.reduce((a, p) => p[1] < a[1] ? p : a); bx = top[0]; by = top[1]; }
      else {
        const t = m.targets[0], c = t && this.boxOf(t);
        if (c && t.whole) { svg += `<rect class="pointing-shape pointing-outline${focus}" x="${c.x + o.x}" y="${c.y + o.y}" width="${c.w}" height="${c.h}"/>`; bx = c.x; by = c.y; }
        else if (c && t.region) { const r = {x: c.x + t.region.x * c.w, y: c.y + t.region.y * c.h, w: t.region.w * c.w, h: t.region.h * c.h}; svg += `<rect class="pointing-shape${focus}" x="${r.x + o.x}" y="${r.y + o.y}" width="${r.w}" height="${r.h}"/>`; bx = r.x; by = r.y; }
        else { bx = s.x; by = s.y; }
        badges += `<span class="pointing-dot" style="left:${s.x + o.x}px;top:${s.y + o.y}px"></span>`;
      }
      badges += `<span class="pointing-badge${focus}" style="left:${bx + o.x}px;top:${by + o.y}px">${m.n}</span>`;
    }
    this.layer.innerHTML = `<svg class="pointing-marks-svg" aria-hidden="true">${svg}</svg>${badges}`;
    this.layer.hidden = !(this.active || sent);
  }
  boxOf(t) {
    const snap = this.board.snapshot;
    if (t.kind === 'placement') { const p = snap.placements.find(x => x.id === t.id && !x.removedAt); const el = p && this.world.querySelector(`.workspace-card[data-placement="${CSS.escape(p.id)}"]`); if (el) { const v = this.view(), r = el.getBoundingClientRect(), a = this.toBoard(r.left, r.top, v); return {x: a.x, y: a.y, w: r.width / v.zoom, h: r.height / v.zoom}; } return p && {x: p.x, y: p.y, w: p.width, h: p.height}; }
    if (t.kind === 'decoration') { const el = this.world.querySelector(`.workspace-decoration[data-decoration="${CSS.escape(t.id)}"]`); if (el) { const v = this.view(), r = el.getBoundingClientRect(), a = this.toBoard(r.left, r.top, v); return {x: a.x, y: a.y, w: r.width / v.zoom, h: r.height / v.zoom}; } }
    return null;
  }
  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(t => { this.frame = 0; this.draw(undefined, t); });
  }
  // The live gesture, on the sheet, in screen pixels: a box or a free shape with what it hits outlined, the laser's
  // dot and trail. The trail fades over 0.7 s after her motion; with nothing left to fade, no frame is drawn.
  draw(v, now = performance.now()) {
    const ctx = this.ctx; if (!ctx || !this.sheetRect) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.sheet.width, this.sheet.height);
    if (!this.active) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const red = this.red ||= getComputedStyle(this.bar).getPropertyValue('--mark-red').trim() || '#B33830';
    const g = this.gesture;
    const outline = (c, view, dashed) => {
      const [x, y] = this.toScreen(c.x, c.y, view); ctx.save(); ctx.strokeStyle = red; ctx.lineWidth = dashed ? 1 : 2; if (dashed) ctx.setLineDash([4, 3]);
      ctx.strokeRect(x - 3, y - 3, c.w * view.zoom + 6, c.h * view.zoom + 6); ctx.restore();
    };
    const fill = () => { ctx.fillStyle = red; ctx.globalAlpha = .07; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = red; ctx.lineWidth = 1.5; ctx.stroke(); };
    if (g && !g.pan && g.moved && (g.tool === 'marquee' || g.tool === 'lasso')) {
      v ||= this.view();
      let hits;
      ctx.beginPath();
      if (g.tool === 'marquee' && g.current) {
        const [x0, y0] = this.toScreen(g.start.x, g.start.y, v), [x1, y1] = this.toScreen(g.current.x, g.current.y, v);
        ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); fill();
        const a = g.start, b = g.current;
        hits = rectHits({x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y)}, g.list);
      } else if (g.tool === 'lasso') {
        g.points.forEach(([x, y], i) => { const [sx, sy] = this.toScreen(x, y, v); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
        ctx.closePath(); fill();
        if (g.points.length > 2) hits = pathHits(g.points.length > 600 ? simplify(g.points, 1 / v.zoom, 400) : g.points, g.list);
      }
      for (const h of hits?.targets || []) outline(h.candidate, v, !h.whole);
    }
    if (!g && this.hover && this.tool !== 'laser') { v ||= this.view(); outline(this.hover, v, true); }
    if (this.tool === 'laser' && this.pointer) {
      const fade = 700, trail = this.trail.filter(p => now - p[2] < fade + 50);
      this.trail = g ? this.trail : trail;
      const r = this.sheetRect;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = red;
      for (let i = 1; i < trail.length; i++) {
        const age = now - trail[i][2], a = Math.max(0, 1 - age / fade); if (!a) continue;
        ctx.globalAlpha = a * .85; ctx.lineWidth = 2 + 2.5 * a;
        ctx.beginPath(); ctx.moveTo(trail[i - 1][0] - r.left, trail[i - 1][1] - r.top); ctx.lineTo(trail[i][0] - r.left, trail[i][1] - r.top); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.fillStyle = red;
      ctx.beginPath(); ctx.arc(this.pointer.x - r.left, this.pointer.y - r.top, 5, 0, Math.PI * 2); ctx.fill();
      if (trail.length > 1 && (g || trail.some(p => now - p[2] < fade))) this.schedule();
    }
  }

  // ---------- sending ----------
  message() {
    const chips = this.chips(), order = new Map(chips.map((c, i) => [c.dataset.mark, i + 1]));
    const parts = [], marks = [];
    let text = '', key = '';
    const flush = () => {
      const clean = text.replace(/ /g, ' ').replace(/[ \t]{2,}/g, ' ');
      if (clean.trim()) { const span = this.words.span(key); parts.push({text: clean, ...(span ? {at: span.at, end: span.end} : {at: null, end: null})}); }
      text = '';
    };
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { text += child.nodeValue.replace(/​/g, ''); continue; }
        if (child.nodeType !== 1) continue;
        if (child.matches('.pointing-chip[data-mark]')) {
          const mark = this.marks.get(child.dataset.mark); if (!mark) continue;
          flush(); key = mark.id;
          parts.push({mark: order.get(mark.id)}); marks.push(mark); continue;
        }
        if (child.matches('.cref')) continue;
        if (child.tagName === 'BR') { text += '\n'; continue; }
        if (/^(DIV|P)$/.test(child.tagName) && text && !text.endsWith('\n')) text += '\n';
        walk(child);
      }
    };
    walk(this.field); flush();
    // Times a stretch has no keystrokes for (pasted, or edited later) take the time of the mark before it.
    for (let i = 0; i < parts.length; i++) if ('text' in parts[i] && parts[i].at == null) {
      const prev = parts.slice(0, i).reverse().find(p => 'mark' in p), m = prev && marks[prev.mark - 1];
      parts[i].at = parts[i].end = m ? m.end : 0;
    }
    if (parts[0]?.text) parts[0].text = parts[0].text.replace(/^\s+/, '');
    if (parts.at(-1)?.text) parts.at(-1).text = parts.at(-1).text.replace(/\s+$/, '');
    const numbered = marks.map(m => ({...m, n: order.get(m.id)}));
    return {parts: parts.filter(p => !('text' in p) || p.text), marks: numbered};
  }
  async send() {
    if (this.sending) return;
    const {parts, marks} = this.message();
    if (!marks.length && !parts.some(p => p.text?.trim())) { this.focusField(); return; }
    const board = this.board, snap = board.snapshot, boardId = snap.id;
    const label = m => `${m.n} ${clip(m.label, 60)}`;
    const body = parts.map(p => 'mark' in p ? `@${label(marks[p.mark - 1])}` : p.text).join('').replace(/[ \t]{2,}/g, ' ').trim() || marks.map(m => `@${label(m)}`).join(' ');
    // Flat refs: every object hit, once; a mark with one object labels it with the mark's chip text, so the thread
    // card's existing chips render the sentence (comment-refs.js renderBody).
    const refs = [], seen = new Set();
    for (const m of marks) for (const t of m.targets) {
      const kind = t.kind === 'board' ? 'board' : t.kind, k = `${kind}:${t.id}`;
      if (seen.has(k) || refs.length >= 20) continue; seen.add(k);
      refs.push({kind, id: t.id, ...(kind === 'board' ? {} : {boardId}), label: (m.targets.length === 1 && !m.more ? label(m) : clip(t.title, 60)).slice(0, 120)});
    }
    const first = marks[0];
    const anchorPoint = first ? centreOf(first.shape) : this.toBoard(this.sheetRect.left + this.sheetRect.width / 2, this.sheetRect.top + this.sheetRect.height / 2);
    const t0 = first?.targets[0];
    const anchor = pointAnchorAt(anchorPoint, snap, t0?.kind === 'placement' ? {placementId: t0.id} : t0?.kind === 'decoration' ? {decorationId: t0.id} : {});
    if (anchor.relative) anchor.relative = {x: Math.min(1, Math.max(0, anchor.relative.x)), y: Math.min(1, Math.max(0, anchor.relative.y))};
    else { delete anchor.placementId; delete anchor.decorationId; }
    const pointing = {
      v: 1, source: 'typed', startedAt: this.startedAt || new Date().toISOString(), sentAt: new Date().toISOString(),
      parts,
      marks: marks.map(m => ({n: m.n, tool: m.tool, at: m.at, end: m.end, boardId: m.boardId, shape: m.shape, targets: m.targets, crop: null, cropNote: CROP_NOTE})),
    };
    const fb = board.feedback?.actor, author = fb?.id ? {id: fb.id, label: fb.label || 'You', kind: 'human'} : {id: 'human-local', label: 'You', kind: 'human'};
    this.sending = true; this.bar.dataset.busy = '';
    try {
      const result = await board.client.write('addComment', {boardId, author, body: body.slice(0, 20000), to: {kind: 'agent'}, status: 'sent', ...(refs.length ? {refs} : {}), anchor, pointing});
      const threadId = result?.threadId || result?.result?.threadId;
      this.clear();
      // Said in place, where her eyes are, until she types again (a toast would sit over the composer).
      this.field.dataset.placeholder = `Sent to the agent${marks.length ? ` with ${marks.length} reference${marks.length === 1 ? '' : 's'}` : ''}. Type the next message.`;
      this.announce('Sent to the agent.');
      board.commentPins?.reload?.();
      return threadId;
    } catch (error) {
      toast(`Not sent: ${error.message}`);
    } finally { this.sending = false; delete this.bar.dataset.busy; if (this.active) this.focusField(); }
  }
  clear() {
    this.field.replaceChildren(); this.caret = null;
    this.marks.clear(); this.nextN = 1; this.t0 = null; this.startedAt = null; this.words.clear(); this.lastLaser = null;
    this.renderMarks();
  }

  // ---------- a sent message, shown on the board while its thread card is open ----------
  showSent(thread, focus = null) {
    const p = thread?.pointing; if (!p?.marks?.length) return;
    this.sent = {threadId: thread.id, marks: p.marks.filter(m => m.boardId === this.board.snapshot.id), focus};
    this.renderMarks();
  }
  revealSent(thread, n) {
    this.showSent(thread, n);
    const m = this.sent?.marks.find(x => x.n === n); if (!m) return false;
    const b = m.shape.kind === 'point' ? {x: m.shape.x - 40, y: m.shape.y - 40, w: 80, h: 80} : m.shape.kind === 'rect' ? m.shape : boundsOf(m.shape.points);
    this.board.hooks.revealPlacements?.([{id: `pointing-${n}`, x: b.x, y: b.y, width: Math.max(b.w, 40), height: Math.max(b.h, 40)}]);
    return true;
  }
  clearSent(threadId) {
    if (!this.sent || (threadId && this.sent.threadId !== threadId)) return;
    this.sent = null; this.renderMarks();
  }

  // ---------- the way in: a key on the canvas tools rail ----------
  addEntry() {
    const rail = document.getElementById('edit-tools'); if (!rail || rail.querySelector('[data-pointing-enter]')) return;
    const group = document.createElement('ui-toolbar-group');
    group.className = 'edit-tool-group'; group.setAttribute('aria-label', 'Pointing');
    group.innerHTML = `<ui-toolbar-button><button type="button" class="tk-btn tk-icon" data-pointing-enter aria-label="Point and type" aria-keyshortcuts="P" data-tip="Point and type">${ICON.enter}</button></ui-toolbar-button>`;
    rail.append(group);
    group.querySelector('button').addEventListener('click', () => this.enter());
    tips(group);
  }
}

function centreOf(s) {
  if (s.kind === 'point') return {x: s.x, y: s.y};
  if (s.kind === 'rect') return {x: s.x + s.w / 2, y: s.y + s.h / 2};
  const b = boundsOf(s.points); return {x: b.x + b.w / 2, y: b.y + b.h / 2};
}
/** A mark in words, for the chip's hint and the live region. */
export function describe(mark) {
  const t = mark.targets;
  if (!t.length) return mark.shape.kind === 'point' ? 'A point on the board' : 'An empty area of the board';
  if (t.length === 1 && !mark.more) return `${t[0].whole ? '' : 'Part of '}${t[0].title}`;
  const names = t.slice(0, 3).map(x => x.title).join(', ');
  return `${t.length + (mark.more || 0)} items: ${names}${t.length > 3 || mark.more ? ', …' : ''}`;
}
