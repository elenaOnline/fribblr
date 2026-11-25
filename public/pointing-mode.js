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
//   Point   ⌥P  click a thing; drag pans
// A click with any tool points at the whole thing under it, and carries the spot clicked; parts come from a drag.
// Keyboard (tool "keyboard"): ⌥R points at what is selected on the board (else the item that had focus); @ in the
// composer picks an item, drawn element or board by name, the selected ones first. ⌥= ⌥− ⌥0 ⌥1 zoom in, out, 100%, fit.
// The unsent draft (words, chips, marks, times) is kept per board for the session, so leaving the page loses nothing.
import {pointingGuard} from './pointing-guard.js';
import {rectHits, pathHits, pointTarget, simplify, boundsOf, closedLoop, intersectRect, polygonArea} from './pointing-geometry.js';
import {esc, attachPicker, decorationLabel, itemLabel} from './comment-refs.js';
import {choiceHTML, setChoice, onChoose} from './ui-toolbar.js';
import {tips} from './tips.js';
import {inPopup} from './popups.js';
import {kindOf} from './kinds.js';
import {pointAnchorAt} from './feedback-geometry.js';
import {toast} from './toasts.js';
import {imageCropFull} from './pointing-crop.js';
import {resourceURL} from './workspace.js';
import {syncPointingChips} from './pointing-thread.js';

const TOOLS = [
  {id: 'marquee', label: 'Marquee', code: 'KeyM', keys: 'Alt+M', icon: '<rect x="3.5" y="4.5" width="13" height="11" rx="1" stroke-dasharray="2.4 2"/>'},
  {id: 'lasso', label: 'Lasso', code: 'KeyL', keys: 'Alt+L', icon: '<path d="M6.5 14.5C3.6 13.4 2.6 10.7 3.6 8.3 4.9 5.3 9 3.6 12.8 4.6c3.4.9 4.6 3.8 3 6.3-1.4 2.2-4.6 3.3-7.6 2.8"/><path d="M8.3 13.6c-.6 1.3-.3 2.6.9 3.1"/>'},
  {id: 'laser', label: 'Laser pointer', code: 'KeyK', keys: 'Alt+K', icon: '<circle cx="13.5" cy="6.5" r="2.2" fill="currentColor" stroke="none"/><path d="M3.5 16.5c2.6-.6 4.4-2.2 5.6-4.4" stroke-dasharray="1.6 1.8"/>'},
  {id: 'point', label: 'Point', code: 'KeyP', keys: 'Alt+P', icon: '<path d="M5 3.5 14.5 9l-4.2 1-2.1 4.3z"/>'},
];
const ICON = {
  enter: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 2.5 11 6.8l-3.3.8-1.6 3.3z"/><path d="M10.5 11.5h6.5v4.2h-3.3l-2 1.8v-1.8h-1.2z"/></svg>',
  close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9"/></svg>',
  selected: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6.5" y="6.5" width="7" height="7" rx="1"/><path d="M3 6.5V3h3.5M13.5 3H17v3.5M17 13.5V17h-3.5M6.5 17H3v-3.5"/></svg>',
};
// Zoom chords inside the mode (plain + − 0 type into the composer): ⌥ with the board's own keys, by key position.
const ZOOM = {Equal: '+', Minus: '-', Digit0: '0', Digit1: 'fit'};
const MAX_MARKS = 20, MAX_TEXT = 20000;
const DRAFT = id => `tinka/pointing-draft/${id}`;
const MODIFIER = new Set(['Shift', 'Alt', 'Meta', 'Control', 'CapsLock', 'Fn', 'AltGraph', 'OS']);
const NOT_ANSWERING = /failed to fetch|networkerror|load failed|network request failed/i;
const STORE = 'tinka/pointing-tool';
const PLACEHOLDER = 'Message to the agent. Point at things as you type.';
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
    this.t0 = null; this.startedAt = null;
    this.words = new TypedWords();
    this.outbox = []; this.line = Promise.resolve(); this.failure = null; // messages being sent, in order
    this.gesture = null; this.hover = null; this.trail = [];
    try { this.tool = TOOLS.some(t => t.id === localStorage.getItem(STORE)) ? localStorage.getItem(STORE) : 'marquee'; } catch { this.tool = 'marquee'; }
    this.viewport = document.getElementById('viewport');
    this.world = document.getElementById('world');
    this.ensureStyle();
    this.buildBar(); this.buildSheet(); this.buildLayer(); this.addEntry();
    // Her unsent draft for this board, kept for the session (leaving the page and coming back loses nothing).
    addEventListener('pagehide', () => this.saveDraft());
    this.restoreDraft();
    // P enters from the board (Adding a shortcut, ui-sdk.md § 3): never in a field or a menu, never with a modifier.
    document.addEventListener('keydown', e => {
      if (this.active || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key.toLowerCase() !== 'p' || e.isComposing) return;
      if (inPopup(e) || board.boardCommandBlocked?.(e) || board.mode !== 'canvas') return;
      e.preventDefault(); e.stopImmediatePropagation(); this.enter();
    }, true);
    this.onGuard = event => this.guard(event);
    // The rail's Point and type key, pressed while the mode is off: the press is the mode's alone, so an open Inspector,
    // comments panel or menu takes it for neither a click-away nor a focus move (brief § 1: her panels stay as they are).
    // An open menu is not a panel: it closes as it would for any press elsewhere, and the same press enters.
    pointingGuard.entry = event => {
      if (!event.target?.closest?.('[data-pointing-enter]')) return false;
      if (event.type === 'mousedown') event.preventDefault();
      else for (const menu of document.querySelectorAll('ui-menu-content[data-open]')) { const root = menu.closest('ui-menu'); if (root?.api?.close) root.api.close(); else if (root) root.open = false; }
      return true;
    };
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
      <button type="button" class="tk-btn tk-icon pointing-selected" aria-label="Point at the selection" aria-keyshortcuts="Alt+R" data-tip="Point at the selection">${ICON.selected}</button>
      <div class="pointing-field-wrap" data-tip-zone><div class="pointing-field" contenteditable="true" data-live-safe role="textbox" aria-multiline="true" aria-label="Message to the agent" data-height="sunken" data-placeholder="${PLACEHOLDER}"></div></div>
      <button type="button" class="tk-btn tk-primary pointing-send" data-height="raised" aria-keyshortcuts="Enter">Send</button>
      <button type="button" class="tk-btn tk-icon pointing-leave" data-height="raised" aria-label="Leave pointing" aria-keyshortcuts="Escape" data-tip="Leave pointing">${ICON.close}</button>
      <p class="pointing-status" role="status" hidden></p>`;
    // In the page's order where it shows, above the footer's view controls: Tab from Leave goes on to them.
    const footer = document.querySelector('.canvas-footer');
    if (footer) footer.before(bar); else document.body.append(bar);
    this.field = bar.querySelector('.pointing-field');
    this.selButton = bar.querySelector('.pointing-selected');
    this.selButton.addEventListener('click', () => this.pointSelection());
    this.status = bar.querySelector('.pointing-status');
    this.tools = bar.querySelector('.pointing-tools');
    onChoose(this.tools, tool => this.setTool(tool || this.tool));
    bar.querySelector('.pointing-send').addEventListener('click', () => this.send());
    bar.querySelector('.pointing-leave').addEventListener('click', () => this.leave());
    this.field.addEventListener('input', e => this.typed(e));
    this.field.addEventListener('paste', e => { // plain text only, so a pasted chip can never be a mark without data
      e.preventDefault(); document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
    });
    // The caret is kept so keys typed after focus went elsewhere land where she left off. selectionchange arrives
    // late and coalesced (it can be keys behind), so the caret is also kept at once after each input and as focus
    // leaves the field.
    const keep = () => { const s = getSelection(); if (this.active && s.rangeCount && this.field.contains(s.anchorNode)) this.caret = s.getRangeAt(0).cloneRange(); };
    document.addEventListener('selectionchange', keep);
    this.field.addEventListener('focusout', keep);
    this.field.addEventListener('input', keep);
    // A press on the bar's keys never takes focus from the composer (guard, chrome()); after one, keys type again.
    bar.addEventListener('click', e => {
      if (!this.barPress) return; this.barPress = false;
      if (this.active && !this.field.contains(e.target)) queueMicrotask(() => { if (this.active && document.activeElement !== this.field) this.focusField(); });
    });
    tips(bar);
    this.syncTool();
  }
  focusField() {
    const s = getSelection();
    // Focused already: the live selection is the caret (selectionchange arrives late, so the kept one can lag a key).
    if (document.activeElement === this.field && s.rangeCount && this.field.contains(s.anchorNode)) return;
    const inside = s.rangeCount && this.field.contains(s.anchorNode);
    this.field.focus({preventScroll: true});
    if (this.caret && this.field.contains(this.caret.startContainer)) { s.removeAllRanges(); s.addRange(this.caret); }
    else if (!inside) { const r = document.createRange(); r.selectNodeContents(this.field); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
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
    // The pointer left the board (onto the bar, the header, a panel): the laser dot and the hover outline go with it.
    sheet.addEventListener('pointerleave', () => { if (this.gesture) return; this.pointer = null; this.hover = null; this.schedule(); });
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
      const line = d.type === 'line';
      // A text box is wider than its words (a heading's box spans the board): what counts is the text as drawn.
      const own = box(el); if (!own) continue;
      const b = (d.type === 'text' && this.inkBox(el, v)) || own;
      out.push({...b, own, key: `decoration:${d.id}`, kind: 'decoration', id: d.id, decoration: d, el, line,
        ...(line ? {points: this.linePoints(el, v)} : {}), frame: d.type === 'region' && !d.sticker && (!!d.container || !d.shape)});
    }
    return out;
  }
  // The words of a text element as drawn, in board units (its text nodes' line boxes, padded a little), or null.
  inkBox(el, v) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), r = document.createRange();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      r.selectNodeContents(n);
      for (const b of r.getClientRects()) { if (!b.width) continue; x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom); }
    }
    if (!(x1 > x0)) return null;
    const pad = 4, a = this.toBoard(x0 - pad, y0 - pad, v);
    return {x: a.x, y: a.y, w: (x1 - x0 + 2 * pad) / v.zoom, h: (y1 - y0 + 2 * pad) / v.zoom};
  }
  // An arrow's drawn line as a polyline in board units (24 samples along its path), or undefined.
  linePoints(el, v) {
    const path = el.querySelector('path.whiteboard-line-stroke, path.whiteboard-line-hit, svg > g path, svg > path');
    if (!path?.getTotalLength) return undefined;
    try {
      const len = path.getTotalLength(), m = path.getScreenCTM(); if (!(len > 0) || !m) return undefined;
      const out = [];
      for (let i = 0; i <= 24; i++) { const p = path.getPointAtLength(len * i / 24), b = this.toBoard(m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f, v); out.push([b.x, b.y]); }
      return out;
    } catch { return undefined; }
  }
  // The thing under a screen point: the topmost card or drawn element the page hit-tests there (a text element only
  // where its words are drawn; beside them, what is under it).
  thingAt(x, y, list, v = this.view()) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === this.sheet || this.bar.contains(el)) continue;
      const hit = el.closest?.('#world .workspace-card[data-placement], #world .workspace-decoration[data-decoration]');
      if (hit) {
        const key = hit.dataset.placement ? `placement:${hit.dataset.placement}` : `decoration:${hit.dataset.decoration}`, c = list.find(x => x.key === key);
        if (c?.decoration?.type === 'text') { const p = this.toBoard(x, y, v); if (p.x < c.x || p.x > c.x + c.w || p.y < c.y || p.y > c.y + c.h) continue; }
        return c || null;
      }
      if (el === this.viewport) break;
    }
    return null;
  }
  target(t) {
    const c = t.candidate, boardId = this.board.snapshot.id;
    if (c.kind === 'placement') {
      const item = c.item, frac = t.region || (t.spot ? {...t.spot, w: 0, h: 0} : null), content = frac && this.contentOf(c, frac);
      return {kind: 'placement', id: c.id, boardId, ...(item?.id ? {itemId: item.id} : {}), itemKind: kindOf(item), title: clip(item?.title || 'Untitled', 120),
        whole: t.whole, ...(t.region ? {region: t.region} : {}), ...(t.spot ? {spot: t.spot} : {}), ...(content ? {content} : {})};
    }
    const d = c.decoration;
    const itemKind = d.type === 'line' ? 'line' : d.type === 'text' ? 'text' : d.sticker ? 'sticker' : d.type !== 'region' ? d.type || 'drawing'
      : d.container ? 'container' : d.shape === 'rectangle' ? 'sticky' : d.shape ? 'shape' : 'region';
    // Hits are measured on what is drawn (a text element's words); regions and spots are fractions of its own box.
    const own = c.own && c.own !== c && (c.own.x !== c.x || c.own.w !== c.w || c.own.y !== c.y || c.own.h !== c.h) ? c.own : null;
    const f = v => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    const re = !own ? null : (r, w) => ({x: f((c.x + r.x * c.w - own.x) / own.w), y: f((c.y + r.y * c.h - own.y) / own.h), ...(w ? {w: f(r.w * c.w / own.w), h: f(r.h * c.h / own.h)} : {})});
    const region = t.region && (re ? re(t.region, true) : t.region), spot = t.spot && (re ? re(t.spot, false) : t.spot);
    return {kind: 'decoration', id: c.id, boardId, itemKind, title: clip(d.sticker ? `Sticker ${d.text || ''}` : decorationLabel(d), 120), whole: t.whole,
      ...(region ? {region} : {}), ...(spot ? {spot} : {})};
  }
  // Where she pointed in the item's own content (CONTRACT "Added after the review"), from `frac` (fractions of the card's
  // box; w = h = 0 for a spot): an HTML page in CSS px of the page at the width the card renders it, an image in px of
  // its file, anything else as fractions of the content area under the card's title. Null when the gesture misses the
  // content area (only the title, say) or the card has none.
  contentOf(c, frac) {
    const card = c.el?.getBoundingClientRect(), area = c.el?.querySelector('.workspace-card-preview');
    if (!card?.width || !area) return null;
    const want = {x: card.left + frac.x * card.width, y: card.top + frac.y * card.height, w: frac.w * card.width, h: frac.h * card.height};
    const spot = !frac.w && !frac.h;
    // `want` inside a screen box `b`: the clipped part, or for a spot the point if it is inside.
    const within = b => {
      if (spot) return want.x >= b.x && want.x <= b.x + b.w && want.y >= b.y && want.y <= b.y + b.h ? {x: want.x, y: want.y, w: 0, h: 0} : null;
      const i = intersectRect(want, b); return i && i.w >= 1 && i.h >= 1 ? i : null;
    };
    const kind = kindOf(c.item), px = n => Math.max(0, Math.round(n));
    const img = kind === 'image' && area.querySelector('img');
    if (img?.naturalWidth > 0) {
      // Where the picture's pixels are inside the <img> box (object-fit), as the crop reads them (pointing-crop.js).
      const shown = img.getBoundingClientRect(), nw = img.naturalWidth, nh = img.naturalHeight, fit = getComputedStyle(img).objectFit || 'fill';
      let cw = shown.width, ch = shown.height;
      if (fit === 'contain' || fit === 'scale-down' || fit === 'cover') { const k0 = (fit === 'cover' ? Math.max : Math.min)(shown.width / nw, shown.height / nh), k = fit === 'scale-down' ? Math.min(1, k0) : k0; cw = nw * k; ch = nh * k; }
      else if (fit === 'none') { cw = nw; ch = nh; }
      const pic = {x: shown.left + (shown.width - cw) / 2, y: shown.top + (shown.height - ch) / 2, w: cw, h: ch};
      const box = intersectRect(pic, {x: shown.left, y: shown.top, w: shown.width, h: shown.height}) || pic, part = within(box); if (!part) return null;
      const kx = nw / pic.w, ky = nh / pic.h;
      return {x: px((part.x - pic.x) * kx), y: px((part.y - pic.y) * ky), w: px(part.w * kx), h: px(part.h * ky), unit: 'px', of: `image ${nw} × ${nh} px`};
    }
    const frame = kind === 'html' && area.querySelector('iframe');
    if (frame?.offsetWidth > 0) {
      // The page's own CSS px: the frame's layout width is the page's width; the card shows it scaled.
      const r = frame.getBoundingClientRect(), k = frame.offsetWidth / r.width, part = within({x: r.left, y: r.top, w: r.width, h: r.height}); if (!part) return null;
      let sx = 0, sy = 0; try { sx = frame.contentWindow?.scrollX || 0; sy = frame.contentWindow?.scrollY || 0; } catch {}
      return {x: px((part.x - r.left) * k + sx), y: px((part.y - r.top) * k + sy), w: px(part.w * k), h: px(part.h * k), unit: 'px', of: `page ${frame.offsetWidth} px wide`};
    }
    const a = area.getBoundingClientRect(); if (!(a.width > 0 && a.height > 0)) return null;
    const part = within({x: a.left, y: a.top, w: a.width, h: a.height}); if (!part) return null;
    const f = v => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
    const x = f((part.x - a.left) / a.width), y = f((part.y - a.top) / a.height);
    return {x, y, w: Math.min(1 - x, f(part.w / a.width)), h: Math.min(1 - y, f(part.h / a.height)), unit: 'fraction', of: 'content area'};
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
    // The @ list is made on first use, so a board that never points has only the comment card's.
    this.picker ||= attachPicker(this.field, this.board, {onChange: () => this.adoptPicked(), first: () => this.pickFirst()});
    this.sizeSheet(); this.renderMarks();
    pointingGuard.handler = this.onGuard;
    this.syncSelectionKey();
    this.focusField();
    this.saveSoon();
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
    this.saveSoon();
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
    if (!onSheet) return this.chrome(e);
    if (e.type === 'pointerdown') this.down(e);
    else if (e.type === 'pointermove') this.move(e);
    else if (e.type === 'pointerup') this.up(e);
    else if (e.type === 'pointercancel') this.cancelGesture();
    else e.preventDefault(); // mousedown, click, dblclick, contextmenu: nothing of the board's
    return true;
  }
  // A press on the mode's own bar is the mode's: no panel or menu outside takes it for a click-away (brief § 1), and a
  // press anywhere on the bar but the field keeps focus in the field (no focus move; after the click it is put back).
  // The @ list (a popup inside the bar) handles its own presses.
  chrome(e) {
    if (e.type !== 'pointerdown' && e.type !== 'mousedown') return false;
    const t = e.target;
    if (!(t instanceof Node) || !this.bar.contains(t) || t.closest?.('.cref-picker')) return false;
    if (!this.field.contains(t)) { this.barPress = true; if (e.type === 'mousedown') e.preventDefault(); }
    return true;
  }
  key(e) {
    if (e.isComposing || e.keyCode === 229) return false;
    const inField = this.field.contains(e.target), inBar = this.bar.contains(e.target);
    // Tools: ⌥ + letter, by key position (⌥M types µ on a Mac), from anywhere.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const tool = TOOLS.find(t => t.code === e.code);
      if (tool) { e.preventDefault(); if (!e.repeat) this.setTool(tool.id); return true; }
      // ⌥R: a reference to what is selected on the board (else the item that had focus), without a pointer.
      if (e.code === 'KeyR') { e.preventDefault(); if (!e.repeat) this.pointSelection(); return true; }
      // Zoom without leaving the composer: ⌥ with the board's + − 0, and ⌥1 fits the board.
      if (ZOOM[e.code] && !inPopup(e)) { e.preventDefault(); if (!e.repeat || ZOOM[e.code] === '+' || ZOOM[e.code] === '-') this.board.hooks.zoomKey?.(ZOOM[e.code]); return true; }
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
    if (MODIFIER.has(e.key)) return false; // a chord's first key (Shift of Shift+Tab) moves nothing
    if (inBar) {
      // The bar's own keys keep Tab, arrows, Space and Enter; anything else is typing, and goes to the composer.
      if (['Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || e.ctrlKey || e.metaKey) return false;
      this.focusField(); return true;
    }
    // Focus elsewhere: in a panel, menu, dialog or field it stays theirs; on the board, keys go to the composer and
    // never to the board's own shortcuts (Delete, ⌘Z, letters).
    if (inPopup(e) || e.target.closest?.(`${FIELD},[role=dialog],dialog,[role=menu],[role=listbox],ui-popover-content`)) return false;
    // On the map or a side panel (not in one of its fields or menus), their keys stay theirs; a letter is typing, and
    // goes to the composer rather than being lost there.
    if (e.target.closest?.('.calm-side,.board-map,.feedback-panel') && (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.key === ' ')) return false;
    if (e.key === 'Tab') return false;
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
    this.pointer = {x: e.clientX, y: e.clientY}; this.lastMove = performance.now();
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
        // The trail from where this loop began stays in play, so a bigger circle closing later is still seen.
        if (loop) { this.circled(loop, ev.timeStamp, v); g.loop = g.loop.slice(Math.max(0, loop.index)); }
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
  // A circle the laser drew: what it encloses is a reference (lasso rules, loose: a circle round a thing's centre that
  // holds most of it is the whole thing). Circling the same thing again at once is emphasis, not a second reference;
  // a bigger circle round it (the first loop closed early, on the way in) takes the place of the smaller one.
  circled({loop}, t, v) {
    const g = this.gesture;
    const points = simplify(loop.map(([x, y]) => { const p = this.toBoard(x, y, v); return [p.x, p.y]; }), 1 / v.zoom, 400);
    const hits = pathHits(points, g.list, {loose: true}), keys = hits.targets.map(h => h.candidate.key).sort().join(' ');
    const last = this.lastLaser, size = polygonArea(points);
    if (last && last.keys === keys && keys && t - last.t < 2500) {
      last.t = t;
      const mark = this.marks.get(last.id), chip = mark && this.field.querySelector(`[data-mark="${mark.id}"]`);
      if (chip && size > last.size * 1.3) {
        last.size = size;
        Object.assign(mark, {shape: {kind: 'path', points: points.map(([x, y]) => [ROUND(x), ROUND(y)])}, targets: hits.targets.map(h => this.target(h)),
          boxes: hits.targets.map(h => dataBox(h.candidate.placement || h.candidate.decoration)), end: this.stamp(t)});
        chip.dataset.tip = describe(mark);
        this.renderMarks(); this.saveSoon();
      }
      return;
    }
    if (this.full()) return;
    const made = this.addMark({tool: 'laser', at: g.at, end: this.stamp(t), shape: {kind: 'path', points: points.map(([x, y]) => [ROUND(x), ROUND(y)])}, hits, empty: 'Board area'});
    if (made) this.lastLaser = {keys, t, id: made.id, size};
    g.at = this.stamp(t);
  }
  // A click: the thing under the pointer, or the board at that spot.
  pointAt(x, y, at, end, tool) {
    const v = this.view(), list = this.candidates(v), p = this.toBoard(x, y, v), hit = this.thingAt(x, y, list, v);
    // The whole thing under the click, with the spot she clicked (a part needs a drag).
    const targets = hit ? [pointTarget(hit, p)] : [];
    this.addMark({tool, at, end, shape: {kind: 'point', x: ROUND(p.x), y: ROUND(p.y)}, hits: {targets, more: 0}, empty: 'Board point'});
  }
  hoverAt(x, y) {
    if (this.tool === 'laser') { this.schedule(); return; }
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      if (!this.active || this.gesture || !this.pointer) return;
      const v = this.view(), hit = this.thingAt(this.pointer.x, this.pointer.y, this.hoverList ||= this.candidates(v), v);
      const key = hit?.key || null;
      if (key !== this.hover?.key) { this.hover = hit; this.draw(v); }
    });
  }

  // ---------- marks and chips ----------
  // Marks on screen now (the chips in the composer); at the limit, a new one is not taken and the bar says why.
  full() {
    if (this.chips().length < MAX_MARKS) return false;
    this.notify(`A message can have at most ${MAX_MARKS} marks. Send this one, or delete a mark first.`);
    return true;
  }
  // The next mark's number: one past every mark of this draft, deleted ones too (Undo can bring a chip back), so a
  // number on screen is never used twice. Sending numbers them 1..n in reading order.
  newN() { let n = 0; for (const m of this.marks.values()) n = Math.max(n, m.n); return n + 1; }
  addMark({tool, at, end, shape, hits, empty}) {
    if (this.full()) return null;
    const targets = hits.targets.map(t => this.target(t));
    const n = this.newN();
    const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const label = targets.length === 0 ? empty : targets.length === 1 && !hits.more ? targets[0].title : `${targets.length + hits.more} items`;
    // `boxes`: where each target was when she pointed (its saved box), so the draft's marks can tell when one moved.
    const boxes = hits.targets.map(t => dataBox(t.candidate.placement || t.candidate.decoration));
    const mark = {id, n, tool, at, end: Math.max(at, end), boardId: this.board.snapshot.id, shape, targets, boxes, more: hits.more, label};
    this.marks.set(id, mark);
    this.hoverList = null;
    this.insertChip(mark);
    this.notice = null; this.syncStatus();
    this.renderMarks();
    this.saveSoon();
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
    let last = null;
    for (const chip of this.field.querySelectorAll('.cref[data-ref]:not([data-mark])')) {
      let ref; try { ref = JSON.parse(chip.dataset.ref); } catch { chip.remove(); continue; }
      if (this.full()) { chip.nextSibling?.nodeType === 3 && chip.nextSibling.nodeValue.startsWith(' ') && (chip.nextSibling.nodeValue = chip.nextSibling.nodeValue.slice(1)); chip.remove(); continue; }
      const key = ref.kind === 'item' ? `placement:${ref.placementId || (this.board.snapshot.placements.find(p => p.itemId === ref.id && !p.removedAt)?.id)}` : `${ref.kind}:${ref.id}`;
      let c = list.find(x => x.key === key);
      if (!c && ref.kind === 'board') c = list.find(x => x.item?.childBoardId === ref.id);
      const t = this.stamp(), n = this.newN(), id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const centre = this.toBoard(this.sheetRect.left + this.sheetRect.width / 2, this.sheetRect.top + this.sheetRect.height / 2, v);
      const targets = c ? [this.target({candidate: c, whole: true})]
        : ref.kind === 'board' ? [{kind: 'board', id: ref.id, boardId: this.board.snapshot.id, itemKind: 'board', title: clip(ref.label, 120), whole: true}] : [];
      const shape = c ? {kind: 'rect', x: ROUND(c.x), y: ROUND(c.y), w: ROUND(c.w), h: ROUND(c.h)} : {kind: 'point', x: ROUND(centre.x), y: ROUND(centre.y)};
      const mark = {id, n, tool: 'keyboard', at: t, end: t, boardId: this.board.snapshot.id, shape, targets, boxes: c ? [dataBox(c.placement || c.decoration)] : [], more: 0, label: targets[0]?.title || ref.label || 'Board point'};
      this.marks.set(id, mark); last = mark;
      const tpl = document.createElement('template'); tpl.innerHTML = this.chipHTML(mark);
      chip.replaceWith(tpl.content.firstElementChild);
    }
    this.renderMarks();
    if (last) { this.reveal(last); this.announce(`${last.n}: ${describe(last)}`); }
    this.saveSoon();
  }
  // The @ list's first group: what is selected on the board (else the item that had focus).
  pickFirst() {
    const {from, list} = this.selectionTargets(), boardId = this.board.snapshot.id;
    const refs = list.map(c => c.kind === 'placement'
      ? (c.item?.childBoardId && !c.item.content ? {kind: 'board', id: c.item.childBoardId, label: itemLabel(c.item)} : {kind: 'item', id: c.item?.id || c.id, boardId, placementId: c.id, label: itemLabel(c.item)})
      : {kind: 'decoration', id: c.id, boardId, label: decorationLabel(c.decoration)}).filter(r => r.id);
    return refs.length ? {label: from, refs} : null;
  }
  // What ⌥R and the bar's Point at the selection key point at: the board's selection (cards and drawn elements), else
  // the item that had focus when she entered. The mode never changes either.
  selectionTargets(v = this.view()) {
    const list = this.candidates(v), keys = [...(this.board.selection || [])].map(id => `placement:${id}`);
    for (const d of this.board.whiteboard?.selectedDecorations?.() || []) keys.push(`decoration:${d.id}`);
    let from = 'Selected';
    if (!keys.length) {
      const f = this.returnFocus?.closest?.('#world .workspace-card[data-placement], #world .workspace-decoration[data-decoration]');
      if (f) { keys.push(f.dataset.placement ? `placement:${f.dataset.placement}` : `decoration:${f.dataset.decoration}`); from = 'Focused'; }
    }
    return {from, list: [...new Set(keys)].map(k => list.find(c => c.key === k)).filter(Boolean)};
  }
  syncSelectionKey() {
    const none = !this.selectionTargets().list.length;
    this.selButton.setAttribute('aria-disabled', String(none));
    this.selButton.dataset.tip = none ? 'Point at the selection (nothing is selected)' : 'Point at the selection';
  }
  // A reference to the selection without a pointer (brief § 6): one mark over all of it, whole.
  pointSelection() {
    if (!this.active) return;
    const v = this.view(), {list} = this.selectionTargets(v);
    if (!list.length) { this.notify('Nothing is selected on the board. Select something before pointing, or type @ and its name.'); this.focusField(); return; }
    const b = boundsOf(list.flatMap(c => [[c.x, c.y], [c.x + c.w, c.y + c.h]])), t = this.stamp();
    const mark = this.addMark({tool: 'keyboard', at: t, end: t, shape: {kind: 'rect', x: ROUND(b.x), y: ROUND(b.y), w: ROUND(b.w), h: ROUND(b.h)},
      hits: {targets: list.slice(0, 12).map(c => ({candidate: c, whole: true})), more: Math.max(0, list.length - 12)}, empty: 'Board area'});
    if (mark) this.reveal(mark);
  }
  // A mark made without the pointer that is off screen: the board brings it into view (leaving puts the view back).
  reveal(mark) {
    const g = this.geometry(mark, true), pts = g.shapes.flatMap(r => r.kind === 'path' ? r.points : [[r.x, r.y], [r.x + r.w, r.y + r.h]]);
    if (!pts.length) return;
    const b = boundsOf(pts), v = this.view(), [x0, y0] = this.toScreen(b.x, b.y, v), [x1, y1] = this.toScreen(b.x + b.w, b.y + b.h, v);
    const r = this.sheetRect, bar = this.bar.getBoundingClientRect();
    if (x1 > 0 && x0 < r.width && y1 > 0 && y0 < Math.min(r.height, bar.top - r.top)) return;
    this.board.hooks.revealPlacements?.([{id: 'pointing', x: b.x, y: b.y, width: Math.max(b.w, 40), height: Math.max(b.h, 40)}]);
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
    if (this.notice) { this.notice = null; this.syncStatus(); }
    this.saveSoon();
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
  // A mark is drawn where its targets are now (geometry), so it keeps pointing at the right thing after a move.
  renderMarks(sent = this.sent) {
    const marks = sent ? sent.marks : this.chips().map(c => this.marks.get(c.dataset.mark));
    const o = this.board.origin || {x: 0, y: 0}, v = marks.length ? this.view() : null;
    let svg = '', badges = '';
    for (const m of marks) {
      const g = this.geometry(m, !sent, v), cls = `pointing-shape${sent && sent.focus === m.n ? ' pointing-focus' : ''}${g.gone ? ' pointing-gone' : ''}`;
      for (const s of g.shapes) {
        if (s.kind === 'path') svg += `<path class="${cls}" data-n="${m.n}" d="M${s.points.map(([x, y]) => `${x + o.x} ${y + o.y}`).join('L')}Z"/>`;
        else svg += `<rect class="${cls}${s.kind === 'outline' ? ' pointing-outline' : ''}" data-n="${m.n}" x="${s.x + o.x}" y="${s.y + o.y}" width="${s.w}" height="${s.h}"/>`;
      }
      if (g.dot) badges += `<span class="pointing-dot${g.gone ? ' pointing-gone' : ''}" style="left:${g.dot.x + o.x}px;top:${g.dot.y + o.y}px"></span>`;
      badges += `<span class="pointing-badge${g.gone ? ' pointing-gone' : ''}" data-n="${m.n}" style="left:${g.badge.x + o.x}px;top:${g.badge.y + o.y}px"><b>${m.n}</b>${g.note ? `<span class="pointing-note">${esc(g.note)}</span>` : ''}</span>`;
      if (!sent) { // the chip says so too
        const chip = this.field.querySelector(`[data-mark="${m.id}"]`), num = chip?.querySelector('.pointing-n');
        if (num && num.textContent !== String(m.n)) num.textContent = String(m.n); // a chip Undo brought back shows its mark's number
        if (chip && chip.classList.contains('missing') !== !!g.gone) { chip.classList.toggle('missing', !!g.gone); chip.dataset.tip = g.gone ? `Deleted: ${describe(m)}` : describe(m); }
      }
    }
    this.layer.innerHTML = `<svg class="pointing-marks-svg" aria-hidden="true">${svg}</svg>${badges}`;
    this.layer.hidden = !(this.active || sent);
  }
  // The board changed under the marks (a render, or a drag in progress: workspace-board.js syncGeometry).
  // While pointing, the board takes an agent's changes as they come (the composer is [data-live-safe]); what is under
  // the pointer is measured again.
  sync() {
    this.hoverList = null;
    if (!this.layer.hidden && (this.sent || this.marks.size)) this.renderMarks();
    if (this.sent) syncPointingChips(this.board);
  }
  // A box in board units for an element as rendered now.
  elementBox(el, v = this.view()) {
    const r = el?.getBoundingClientRect(); if (!(r?.width > 0 && r.height > 0)) return null;
    const a = this.toBoard(r.left, r.top, v); return {x: a.x, y: a.y, w: r.width / v.zoom, h: r.height / v.zoom};
  }
  // Where a target is now: {now, box} (its saved box, and its box as drawn, either may be null), {gone: true}, or {}
  // for a board.
  locate(t, v) {
    const snap = this.board.snapshot;
    if (t.kind === 'placement') {
      const p = snap.placements.find(x => x.id === t.id && !x.removedAt); if (!p) return {gone: true};
      const now = dataBox(p);
      return {now, box: this.elementBox(this.world.querySelector(`.workspace-card[data-placement="${CSS.escape(p.id)}"]`), v) || now};
    }
    if (t.kind === 'decoration') {
      const d = (snap.decorations || []).find(x => x.id === t.id); if (!d) return {gone: true};
      const now = dataBox(d);
      const el = this.world.querySelector(`.workspace-decoration[data-decoration="${CSS.escape(t.id)}"]`);
      // A whole text element is outlined round its words as drawn; a part is a region of its own box.
      return {now, box: this.elementBox(el, v) || now, ink: d.type === 'text' && el ? this.inkBox(el, v) : null};
    }
    return {};
  }
  // What to draw for a mark, from where its targets are now. `then` is each target's saved box when she pointed (the
  // draft keeps it) or when the message was sent (the server stores it as `placed`).
  // - Nothing moved: the shape exactly as she drew it.
  // - One target, moved or resized: the shape as drawn, carried with it (same place on the object, same proportions).
  // - Otherwise (several targets moved apart, or no saved box): each target where it is now, a whole one outlined, a
  //   part as its region (fractions of the target's own box).
  // - Every target gone: the shape as drawn, plain and dashed, labelled Deleted; some gone: "1 of 3 deleted".
  // Empty space (no targets) is a board position and stays where it was drawn.
  geometry(m, draft, v = this.view()) {
    const s = m.shape;
    const drawnShapes = shape => shape.kind === 'point' ? [] : [shape.kind === 'rect' ? {kind: 'rect', x: shape.x, y: shape.y, w: shape.w, h: shape.h} : {kind: 'path', points: shape.points}];
    const drawn = {shapes: drawnShapes(s), dot: s.kind === 'point' ? {x: s.x, y: s.y} : null, badge: s.kind === 'point' ? {x: s.x, y: s.y} : topLeft(s), note: '', gone: false};
    const placed = m.targets.map((t, i) => ({t, then: draft ? m.boxes?.[i] : t.placed, ...this.locate(t, v)})).filter(x => x.t.kind !== 'board');
    if (!placed.length) return drawn;
    const gone = placed.filter(x => x.gone).length;
    if (gone === placed.length) return {...drawn, gone: true, note: placed.length === 1 ? 'Deleted' : 'All deleted'};
    const live = placed.filter(x => !x.gone && x.box);
    if (!live.length) return drawn;
    const note = gone ? `${gone} of ${placed.length} deleted` : '';
    // A click names its target, outlined or as the spot clicked; the dot is where she clicked.
    const ofTarget = ({t, box, ink}) => t.whole || !t.region ? {kind: 'outline', ...(ink || box)}
      : {kind: 'rect', x: box.x + t.region.x * box.w, y: box.y + t.region.y * box.h, w: t.region.w * box.w, h: t.region.h * box.h};
    const near = (a, b) => a && b && ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) <= .5);
    const still = !gone && placed.every(x => near(x.then, x.now));
    const carry = !still && !gone && live.length === 1 && placed.length === 1 && live[0].then?.w > 0 && live[0].then.h > 0 && live[0].now;
    const map = carry ? ((a, b) => ([x, y]) => [b.x + (x - a.x) * b.w / a.w, b.y + (y - a.y) * b.h / a.h])(live[0].then, live[0].now) : null;
    if (s.kind === 'point') {
      const shapes = live.map(ofTarget), [dx, dy] = still ? [s.x, s.y] : map ? map([s.x, s.y]) : [];
      const dot = dx != null ? {x: dx, y: dy} : shapes[0].kind === 'rect' ? {x: shapes[0].x + shapes[0].w / 2, y: shapes[0].y + shapes[0].h / 2} : null;
      return {shapes, dot, badge: {x: Math.min(...shapes.map(r => r.x)), y: Math.min(...shapes.map(r => r.y))}, note, gone: false};
    }
    if (still) return drawn;
    if (map) {
      const moved = s.kind === 'rect' ? (([x0, y0], [x1, y1]) => ({kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0}))(map([s.x, s.y]), map([s.x + s.w, s.y + s.h]))
        : {kind: 'path', points: s.points.map(map)};
      return {shapes: drawnShapes(moved), dot: null, badge: topLeft(moved), note, gone: false};
    }
    const shapes = live.map(ofTarget);
    return {shapes, dot: null, badge: {x: Math.min(...shapes.map(r => r.x)), y: Math.min(...shapes.map(r => r.y))}, note, gone: false};
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
    if (this.tool === 'laser' && (this.pointer || this.trail.length)) {
      const fade = 700, trail = this.trail.filter(p => now - p[2] < fade + 50);
      this.trail = g ? this.trail : trail;
      const r = this.sheetRect;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = red;
      // Five steps of fade, one stroke each: the newest part strongest and widest.
      for (let step = 1; step <= 5; step++) {
        const lo = (step - 1) / 5, hi = step / 5; let open = false;
        ctx.beginPath();
        for (let i = 1; i < trail.length; i++) {
          const a = 1 - (now - trail[i][2]) / fade;
          if (a <= lo || a > hi) { open = false; continue; }
          if (!open) { ctx.moveTo(trail[i - 1][0] - r.left, trail[i - 1][1] - r.top); open = true; }
          ctx.lineTo(trail[i][0] - r.left, trail[i][1] - r.top);
        }
        ctx.globalAlpha = hi * .85; ctx.lineWidth = 2 + 2.5 * hi; ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.fillStyle = red;
      if (this.pointer) { ctx.beginPath(); ctx.arc(this.pointer.x - r.left, this.pointer.y - r.top, 5, 0, Math.PI * 2); ctx.fill(); }
      // Fading needs frames of its own only while she holds still: a frame requested from a frame while she moves
      // holds her next move back a frame (measured: 32 ms against 17 ms), so moves drive the frames then.
      if (trail.length > 1 && trail.some(p => now - p[2] < fade)) {
        if (g && performance.now() - (this.lastMove || 0) < 50) { clearTimeout(this.fadeTimer); this.fadeTimer = setTimeout(() => this.schedule(), 60); }
        else this.schedule();
      }
    }
  }

  // ---------- sending ----------
  message() {
    const chips = this.chips(), order = new Map(chips.map((c, i) => [c.dataset.mark, i + 1]));
    const parts = [], marks = [];
    let text = '', key = '';
    const flush = () => {
      const clean = text.replace(/ /g, ' ').replace(/[ \t]{2,}/g, ' ');
      // A run of spaces between two marks is kept as one space, so the marks never run together.
      if (clean) { const span = this.words.span(key); parts.push({text: clean.trim() ? clean : ' ', ...(span ? {at: span.at, end: span.end} : {at: null, end: null})}); }
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
  // Send never makes her wait: the message is taken out of the composer at once, so she can write the next one while
  // the server renders its crops (1–3 s). Messages go one at a time, in order. A quiet line on the bar says what is
  // in flight; a message that fails comes back into the composer, words, chips and marks, with the reason.
  send() {
    const {parts, marks} = this.message();
    if (!marks.length && !parts.some(p => p.text?.trim())) { this.focusField(); return null; }
    const board = this.board, snap = board.snapshot, boardId = snap.id;
    const label = m => `${m.n} ${clip(m.label, 60)}`;
    const body = parts.map(p => 'mark' in p ? `@${label(marks[p.mark - 1])}` : p.text).join('').replace(/[ \t]{2,}/g, ' ').trim() || marks.map(m => `@${label(m)}`).join(' ');
    // Too long to send: said now, and the message stays where it is.
    if (body.length > MAX_TEXT) {
      this.notify(`A message can be at most ${MAX_TEXT.toLocaleString('en-US')} characters. This one has ${body.length.toLocaleString('en-US')}: shorten it and send again.`);
      this.focusField(); return null;
    }
    // Flat refs: every object hit, once; a mark with one object labels it with the mark's chip text, so the thread
    // card's existing chips render the sentence (comment-refs.js renderBody).
    const refs = [], seen = new Set();
    for (const m of marks) for (const t of m.targets) {
      const kind = t.kind === 'board' ? 'board' : t.kind, k = `${kind}:${t.id}`;
      if (seen.has(k) || refs.length >= 20) continue; seen.add(k);
      refs.push({kind, id: t.id, ...(kind === 'board' ? {} : {boardId}), label: (m.targets.length === 1 && !m.more ? label(m) : clip(t.title, 60)).slice(0, 120)});
    }
    const first = marks[0];
    // The thread's pin sits at the first mark's top-right corner (its number badge is top-left), so it never covers
    // what she pointed at.
    // A click's mark is the whole thing outlined: the pin goes at that outline's top-right, not on the spot clicked.
    const drawn = first && first.shape.kind === 'point' ? this.geometry(first, true).shapes : [];
    const anchorPoint = drawn.length ? pinPointOf({kind: 'path', points: drawn.flatMap(r => r.kind === 'path' ? r.points : [[r.x, r.y], [r.x + r.w, r.y + r.h]])})
      : first ? pinPointOf(first.shape) : this.toBoard(this.sheetRect.left + this.sheetRect.width / 2, this.sheetRect.top + this.sheetRect.height / 2);
    const t0 = first?.targets[0];
    const anchor = pointAnchorAt(anchorPoint, snap, t0?.kind === 'placement' ? {placementId: t0.id} : t0?.kind === 'decoration' ? {decorationId: t0.id} : {});
    if (anchor.relative) anchor.relative = {x: Math.min(1, Math.max(0, anchor.relative.x)), y: Math.min(1, Math.max(0, anchor.relative.y))};
    else { delete anchor.placementId; delete anchor.decorationId; }
    const appearance = document.documentElement.dataset.appearance === 'dark' ? 'dark' : 'light';
    const pointing = {
      v: 1, source: 'typed', startedAt: this.startedAt || new Date().toISOString(), sentAt: new Date().toISOString(), appearance,
      parts,
      marks: marks.map(m => ({n: m.n, tool: m.tool, at: m.at, end: m.end, boardId: m.boardId, shape: m.shape, targets: m.targets, crop: null})),
    };
    const fb = board.feedback?.actor, author = fb?.id ? {id: fb.id, label: fb.label || 'You', kind: 'human'} : {id: 'human-local', label: 'You', kind: 'human'};
    const job = {draft: this.takeDraft(), operation: {boardId, author, body, to: {kind: 'agent'}, status: 'sent', ...(refs.length ? {refs} : {}), anchor, pointing}, count: marks.length};
    this.notice = null;
    this.clear();
    this.field.dataset.placeholder = 'Type the next message.';
    this.outbox.push(job); this.failure = null; this.syncStatus();
    this.focusField();
    job.done = this.line = this.line.then(() => this.deliver(job));
    return job.done;
  }
  async deliver(job) {
    const board = this.board;
    try {
      // A mark on part (or all) of one image item: the picture's own pixels, cropped here at full resolution; the
      // server renders every other mark from the board.
      for (const m of job.operation.pointing.marks) {
        const t = m.targets.length === 1 && m.targets[0].kind === 'placement' && m.targets[0].itemKind === 'image' ? m.targets[0] : null;
        if (!t || m.boardId !== board.snapshot.id) continue;
        await new Promise(r => setTimeout(r)); // one crop per task, so typing is never held up
        const card = this.world.querySelector(`.workspace-card[data-placement="${CSS.escape(t.id)}"]`);
        const p = board.snapshot.placements.find(x => x.id === t.id), item = p && board.snapshot.items?.[p.itemId];
        const file = item?.content?.kind === 'image' ? resourceURL(item.content.resource) : null;
        const crop = card ? await imageCropFull(card, t.whole ? undefined : t.region, file).catch(() => null) : null;
        if (crop) m.crop = {dataUrl: crop.dataUrl, from: `the image item's own file, cropped in the browser: ${crop.from.replace(/^image file,?\s*/, '')}`.slice(0, 600)};
      }
      const result = await board.client.write('addComment', job.operation);
      this.outbox.splice(this.outbox.indexOf(job), 1);
      this.saveSoon();
      this.lastSent = job.count;
      this.syncStatus();
      this.announce('Sent to the agent.');
      board.commentPins?.reload?.();
      return result?.threadId || result?.result?.threadId;
    } catch (error) {
      this.outbox.splice(this.outbox.indexOf(job), 1);
      this.giveBack(job.draft, error);
      return null;
    }
  }
  // The composer's content as it stands, to send and, if sending fails, to give back.
  takeDraft() {
    return {nodes: [...this.field.childNodes].map(n => n.cloneNode(true)), marks: new Map(this.marks), words: new Map(this.words.times),
      t0: this.t0, startedAt: this.startedAt};
  }
  // A message that did not go: back in the composer. If she has started the next one, the old one goes before it on
  // its own line, and the marks are numbered again in reading order.
  giveBack(draft, error) {
    const empty = !this.chips().length && !this.field.textContent.trim();
    if (empty) {
      this.field.replaceChildren(...draft.nodes);
      this.marks = draft.marks; this.words.times = draft.words; this.t0 = draft.t0; this.startedAt = draft.startedAt;
    } else {
      // Times are from the old message's start; the new one's are moved onto that clock.
      const shift = this.t0 != null && draft.t0 != null ? Math.max(0, Math.round(this.t0 - draft.t0)) : 0;
      for (const m of this.marks.values()) { m.at += shift; m.end += shift; }
      const lastOld = [...draft.nodes].reverse().map(n => n.nodeType === 1 && n.matches('.pointing-chip[data-mark]') ? n.dataset.mark : n.nodeType === 1 ? [...n.querySelectorAll('.pointing-chip[data-mark]')].at(-1)?.dataset.mark : null).find(Boolean) || '';
      const times = new Map(draft.words);
      for (const [key, span] of this.words.times) {
        const k = key || lastOld, moved = {at: span.at + shift, end: span.end + shift}, had = times.get(k);
        times.set(k, had ? {at: Math.min(had.at, moved.at), end: Math.max(had.end, moved.end)} : moved);
      }
      this.words.times = times;
      for (const [id, m] of draft.marks) this.marks.set(id, m);
      this.field.prepend(...draft.nodes, document.createTextNode('\n'));
      this.t0 = draft.t0 ?? this.t0; this.startedAt = draft.startedAt || this.startedAt;
      const chips = this.chips(), live = new Set(chips.map(c => c.dataset.mark));
      chips.forEach((chip, i) => { const m = this.marks.get(chip.dataset.mark); m.n = i + 1; chip.querySelector('.pointing-n').textContent = String(i + 1); });
      // Marks whose chips were deleted (Undo can bring them back) take the numbers after, so none is on screen twice.
      let n = chips.length; for (const [id, m] of this.marks) if (!live.has(id)) m.n = ++n;
    }
    // Plain reasons: the app not answering, or what the server said (lib/feedback.mjs words its refusals for her).
    const said = String(error?.message || error || '').trim().replace(/\.$/, ''), back = `Your message is back in the field${empty ? '' : ', before the one you were writing'}.`;
    this.failure = !said || NOT_ANSWERING.test(said) || error?.name === 'TypeError' ? `The app isn't answering. ${back}` : `Not sent: ${said}. ${back}`;
    this.saveSoon();
    this.syncStatus();
    this.renderMarks();
    if (this.active) this.focusField();
    else toast(`${this.failure.replace('in the field', 'in Point and type')}`);
    this.announce(this.failure);
  }
  // The line on the bar: what is sending, what failed; after a send, the placeholder says it went.
  syncStatus() {
    const n = this.outbox.length, el = this.status;
    const text = this.notice || this.failure || (n ? (n === 1 ? 'Sending…' : `Sending ${n} messages…`) : '');
    el.textContent = text; el.hidden = !text; el.toggleAttribute('data-error', !!this.notice || (!!this.failure && !n));
    if (!n && !this.failure && this.lastSent != null) {
      const k = this.lastSent; this.lastSent = null;
      this.field.dataset.placeholder = `Sent to the agent${k ? ` with ${k} reference${k === 1 ? '' : 's'}` : ''}. Type the next message.`;
    }
  }
  clear() {
    this.field.replaceChildren(); this.caret = null;
    this.marks = new Map(); this.t0 = null; this.startedAt = null; this.words = new TypedWords(); this.lastLaser = null;
    this.renderMarks();
    this.saveSoon();
  }
  // A line on the bar that explains why something was not taken (the mark limit, a message too long, nothing
  // selected); it goes at her next keystroke or mark.
  notify(text) { this.notice = text; this.syncStatus(); this.announce(text); }

  // ---------- the draft, kept per board for the session ----------
  // Words (the composer's own markup, chips included), marks, typing times and whether the mode was on. Messages still
  // sending when the page goes are kept too: on return, one the server does not have comes back into the composer.
  draftState() {
    const html = this.field.innerHTML, has = !!this.field.textContent.trim() || !!this.field.querySelector('.pointing-chip');
    const pending = this.outbox.map(job => ({html: job.draft.nodes.map(n => n.nodeType === 1 ? n.outerHTML : esc(n.nodeValue || '')).join(''),
      marks: [...job.draft.marks.values()], words: [...job.draft.words], startedAt: job.operation.pointing.startedAt}));
    if (!has && !pending.length) return null;
    return {v: 1, html: has ? html : '', marks: has ? [...this.marks.values()] : [], words: has ? [...this.words.times] : [], startedAt: this.startedAt,
      elapsed: this.t0 == null ? null : performance.now() - this.t0, savedAt: Date.now(), active: this.active, pending};
  }
  saveDraft() {
    clearTimeout(this.saveTimer); this.saveTimer = 0;
    const id = this.boardId || this.board.snapshot?.id; if (!id || this.restoring) return;
    try { const state = this.draftState(); if (state) sessionStorage.setItem(DRAFT(id), JSON.stringify(state)); else sessionStorage.removeItem(DRAFT(id)); } catch {}
  }
  saveSoon() { if (!this.saveTimer) this.saveTimer = setTimeout(() => this.saveDraft(), 250); }
  async restoreDraft() {
    const id = this.board.snapshot?.id; let state = null;
    try { state = JSON.parse(sessionStorage.getItem(DRAFT(id)) || 'null'); } catch {}
    if (!state || state.v !== 1) return;
    this.boardId = id;
    const clock = (elapsed, savedAt) => elapsed == null ? null : performance.now() - elapsed - Math.max(0, Date.now() - savedAt);
    if (state.html) {
      this.field.innerHTML = state.html;
      for (const chip of this.field.querySelectorAll('.pointing-chip')) chip.removeAttribute('data-ref');
      this.marks = new Map(state.marks.map(m => [m.id, m]));
      this.words.times = new Map(state.words);
      this.startedAt = state.startedAt; this.t0 = clock(state.elapsed, state.savedAt);
    }
    if (state.active) requestAnimationFrame(() => this.enter());
    // Messages that were still sending as she left: the server has them, or they come back, before her draft.
    if (state.pending?.length) {
      this.restoring = true;
      let have = new Set();
      try {
        const data = await this.board.client.get(`/api/feedback?${new URLSearchParams({boardId: id, includeBodies: 'true', limit: '100'})}`);
        have = new Set((data.threads || []).map(t => t.pointing?.startedAt).filter(Boolean));
      } catch { /* unknown: give them back rather than lose them */ }
      this.restoring = false;
      for (const job of state.pending.reverse()) {
        if (have.has(job.startedAt)) continue;
        const tpl = document.createElement('template'); tpl.innerHTML = job.html;
        this.giveBack({nodes: [...tpl.content.childNodes], marks: new Map(job.marks.map(m => [m.id, m])), words: new Map(job.words), t0: clock(0, Date.now()), startedAt: job.startedAt},
          new Error('It was still sending when you left the page'));
      }
      this.saveDraft();
    }
    if (!this.active) this.renderMarks();
  }

  // The open thread's marks on screen, as a client box {left, top, right, bottom}, so its card can sit clear of them
  // (comment-thread.js); null when none show. A whole thing's outline is left out (a big card cannot be cleared; its
  // number and the spot clicked can).
  sentScreenBox(threadId) {
    if (!this.sent || this.sent.threadId !== threadId || this.layer.hidden) return null;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const el of this.layer.querySelectorAll('.pointing-shape:not(.pointing-outline), .pointing-badge, .pointing-dot')) {
      const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
      left = Math.min(left, r.left); top = Math.min(top, r.top); right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    }
    return right > left ? {left, top, right, bottom} : null;
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
    const g = this.geometry(m, false), b = g.shapes.length ? boundsOf(g.shapes.flatMap(r => r.kind === 'path' ? r.points : [[r.x, r.y], [r.x + r.w, r.y + r.h]]))
      : {x: g.dot.x - 40, y: g.dot.y - 40, w: 80, h: 80};
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

// A placement's or drawn element's saved box (board units), as the server stores `placed`; null when it has none.
const dataBox = o => o && [o.x, o.y, o.width, o.height].every(Number.isFinite) ? {x: o.x, y: o.y, w: o.width, h: o.height} : null;
// Where a mark's number sits for a shape as drawn: its top-left corner, or a path's topmost point.
function topLeft(s) {
  if (s.kind === 'rect') return {x: s.x, y: s.y};
  const top = s.points.reduce((a, p) => p[1] < a[1] ? p : a); return {x: top[0], y: top[1]};
}
function pinPointOf(s) {
  if (s.kind === 'point') return {x: s.x, y: s.y};
  const b = s.kind === 'rect' ? s : boundsOf(s.points); return {x: b.x + b.w, y: b.y};
}
/** A mark in words, for the chip's hint and the live region. */
export function describe(mark) {
  const t = mark.targets;
  if (!t.length) return mark.shape.kind === 'point' ? 'A point on the board' : 'An empty area of the board';
  if (t.length === 1 && !mark.more) return `${t[0].whole ? '' : 'Part of '}${t[0].title}`;
  const names = t.slice(0, 3).map(x => x.title).join(', ');
  return `${t.length + (mark.more || 0)} items: ${names}${t.length > 3 || mark.more ? ', …' : ''}`;
}
