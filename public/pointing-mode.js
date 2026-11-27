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
//   Wand    ⌥W  a brush ring instead of the cursor that sheds a few sparkles as it moves. Hold the button and wave,
//               underline or circle: what the held drag sweeps (a wide band, plus the inside of a loop) is one
//               reference, drawn as glitter. Moving without the button (travelling, typing, resting) never points.
//               A new press within 1.2 s where the last drag ended, before any typing, carries on the same reference
//               (a lift mid-wave). ⌥[ ⌥] change the band's width. A click points.
//   Point   ⌥P  click a thing; drag pans
// A click with any tool points at the whole thing under it, and carries the spot clicked; parts come from a drag. It is
// recorded as tool "click" with the active tool in `via`.
// Snapping (pointing-snap.js): a marquee, lasso or wand area that mostly covers a card, drawing, container or text is
// tidied to it; the snapped outline shows while the user drags; holding ⌘ (Ctrl off a Mac) takes exactly what the user drew.
// Keyboard (tool "keyboard"): ⌥R points at what is selected on the board (else the item that had focus); @ in the
// composer picks an item, drawn element or board by name, the selected ones first. ⌥= ⌥− ⌥0 ⌥1 zoom in, out, 100%, fit.
// The unsent draft (words, chips, marks, times) is kept per board for the session, so leaving the page loses nothing.
import {pointingGuard} from './pointing-guard.js';
import {rectHits, pathHits, areaHits, pointTarget, simplify, boundsOf, intersectRect, polygonArea, pointInPolygon} from './pointing-geometry.js';
import {SwathField, WAND, paintField, fleckSize, ringsOf, outlinePointsOf, inRings} from './pointing-wand.js';
import {objectSnap, bestProposal} from './pointing-snap.js';
import {esc, attachPicker, decorationLabel, itemLabel} from './comment-refs.js';
import {choiceHTML, setChoice, onChoose} from './ui-toolbar.js';
import {tips} from './tips.js';
import {inPopup} from './popups.js';
import {kindOf} from './kinds.js';
import {pointAnchorAt} from './feedback-geometry.js';
import {toast} from './toasts.js';
import {imageCropFull, imageFileCrop} from './pointing-crop.js';
import {resourceURL} from './workspace.js';
import {syncPointingChips} from './pointing-thread.js';
import {ReaderPlace, placeKey, textRangeIn, toTop} from './pointing-reader.js';
import {domSnap, pageMapping, resolveFrame} from './pointing-snap-dom.js';
import {pixelSnap} from './pointing-snap-pixels.js';

const TOOLS = [
  {id: 'marquee', label: 'Marquee', code: 'KeyM', keys: 'Alt+M', icon: '<rect x="3.5" y="4.5" width="13" height="11" rx="1" stroke-dasharray="2.4 2"/>'},
  {id: 'lasso', label: 'Lasso', code: 'KeyL', keys: 'Alt+L', icon: '<path d="M6.5 14.5C3.6 13.4 2.6 10.7 3.6 8.3 4.9 5.3 9 3.6 12.8 4.6c3.4.9 4.6 3.8 3 6.3-1.4 2.2-4.6 3.3-7.6 2.8"/><path d="M8.3 13.6c-.6 1.3-.3 2.6.9 3.1"/>'},
  {id: 'wand', label: 'Wand', code: 'KeyW', keys: 'Alt+W', icon: '<path d="m3.5 16.5 7.6-7.6"/><path d="M14 2.6l.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9z" fill="currentColor" stroke-width="1"/><rect x="16.2" y="11" width="1.7" height="1.7" fill="currentColor" stroke="none"/><rect x="8.6" y="3.2" width="1.7" height="1.7" fill="currentColor" stroke="none"/>'},
  {id: 'point', label: 'Point', code: 'KeyP', keys: 'Alt+P', icon: '<path d="M5 3.5 14.5 9l-4.2 1-2.1 4.3z"/>'},
];
const ICON = {
  enter: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 2.5 11 6.8l-3.3.8-1.6 3.3z"/><path d="M10.5 11.5h6.5v4.2h-3.3l-2 1.8v-1.8h-1.2z"/></svg>',
  close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9"/></svg>',
  selected: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6.5" y="6.5" width="7" height="7" rx="1"/><path d="M3 6.5V3h3.5M13.5 3H17v3.5M17 13.5V17h-3.5M6.5 17H3v-3.5"/></svg>',
  // A mark made inside an opened item: a window with a point in it (on its chip).
  inside: '<svg class="pointing-in" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1.5" width="10" height="9" rx="1.5"/><path d="M1 4h10"/><rect x="5" y="6" width="2" height="2" fill="currentColor" stroke="none"/></svg>',
};
// Zoom chords inside the mode (plain + − 0 type into the composer): ⌥ with the board's own keys, by key position.
const ZOOM = {Equal: '+', Minus: '-', Digit0: '0', Digit1: 'fit'};
const MAX_MARKS = 20, MAX_TEXT = 20000;
const DRAFT = id => `tinka/pointing-draft/${id}`;
const MODIFIER = new Set(['Shift', 'Alt', 'Meta', 'Control', 'CapsLock', 'Fn', 'AltGraph', 'OS']);
const NOT_ANSWERING = /failed to fetch|networkerror|load failed|network request failed/i;
const STORE = 'tinka/pointing-tool', SIZE_STORE = 'tinka/pointing-wand-size';
// The key that takes exactly what the user drew (no snapping), held: ⌘ on a Mac, Ctrl elsewhere.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const RAW_KEY = MAC ? 'Meta' : 'Control', rawHeld = e => MAC ? !!e.metaKey : !!e.ctrlKey;
const WAND_SESSION = 1200;       // ms after a wand drag ends in which a new press where it ended carries it on (tldraw's laser session)
// A slip is not a gesture: a press whose pointer stays within SLIP px of where it went down (and travels under twice
// that) is a click, whatever the tool. A wand drag that is a dash, straight (DASH.straight of its path is
// the distance between its ends), quick (over DASH.speed px/ms on average), long (over DASH.length px) and released
// off anything, is the hand moving with the button down, not a wave: it is not taken. Natural waving and underlining
// run at 0.3–2.5 px/ms (measured on the showcase boards, 2026-11-26); an accidental dash across a board runs at 6 and up.
const SLIP = 10, DASH = {straight: 0.9, speed: 4, length: 240};
// A lift mid-wave carries the reference on when the new press is close (half the band), further along the line the
// stroke was travelling (up to WAND_REACH band-widths ahead or behind, within ±37°), or on the thing it points at.
const WAND_REACH = 4;
const FRESH = 280;               // ms a newly swept cell sparkles before it settles
const PLACEHOLDER = 'Message to the agent. Point at things as you type.';
const ROUND = v => Math.round(v * 10) / 10;
const BLOCKS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th', 'pre', 'dd', 'dt', 'figcaption', 'div', 'article', 'section', 'ul', 'ol', 'table']);
const FAINT = 0.4;               // a snapped wand mark's own sweep, under the outline (lib/pointing-crop.mjs glitterOf draws it at 0.4 too)
const LATE = 120;                // ms a release waits at most for a source that answers later (the pixel worker)
const PART_SCORE = 0.5;          // a source inside a card beats the whole card from this score (proposal)
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
    this.gesture = null; this.hover = null;
    try { const kept = localStorage.getItem(STORE) === 'laser' ? 'wand' : localStorage.getItem(STORE); this.tool = TOOLS.some(t => t.id === kept) ? kept : 'marquee'; } catch { this.tool = 'marquee'; }
    try { const w = Number(localStorage.getItem(SIZE_STORE)); this.wandWidth = WAND.sizes.includes(w) ? w : WAND.width; } catch { this.wandWidth = WAND.width; }
    this.snapSources = [];         // sources inside one item (addSnapSource); the board-object source is always on
    this.reader = null;            // the opened item, while the mode points inside it (pointing-reader.js)
    this.prepared = new WeakSet(); // candidates' elements the sources have been asked to prepare (first hover)
    this.commits = Promise.resolve(); this.waiting = 0; // gestures waiting for a source that answers later commit in order
    this.raw = false;              // the take-what-I-drew key is held
    this.sparks = [];              // the wand's hover sparkles: [x, y, born, life] in screen px
    this.glitter = new Map();      // committed wand marks' canvases, by what they draw
    this.viewport = document.getElementById('viewport');
    this.world = document.getElementById('world');
    this.ensureStyle();
    this.buildBar(); this.buildSheet(); this.buildLayer(); this.addEntry();
    // The user's unsent draft for this board, kept for the session (leaving the page and coming back loses nothing).
    addEventListener('pagehide', () => this.saveDraft());
    this.restoreDraft();
    this.wireSources();
    // P enters from the board (Adding a shortcut, ui-sdk.md § 3): never in a field or a menu, never with a modifier.
    document.addEventListener('keydown', e => {
      if (this.active || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key.toLowerCase() !== 'p' || e.isComposing) return;
      if (inPopup(e) || board.mode !== 'canvas') return;
      // In the opened item (a modal dialog, which the board's own check counts as blocking): not in a field, a panel or
      // the Navigator; on its canvas or its chrome, P enters there.
      if (board.hooks.reader?.()) { if (e.target.closest?.(`${FIELD},[role=textbox],[role=slider],.calm-side,.project-navigator,#notes-panel,.feedback-panel`)) return; }
      else if (board.boardCommandBlocked?.(e)) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.enter();
    }, true);
    this.onGuard = event => this.guard(event);
    pointingGuard.mode = this; // the board's mode, for wiring snap sources (addSnapSource) and for tests
    // The take-what-I-drew key let go (or the window lost focus with it down): snapping is back on at once.
    addEventListener('keyup', e => { if (this.active && e.key === RAW_KEY) this.setRaw(false); }, true);
    addEventListener('blur', () => this.setRaw(false));
    // Committed wand marks are drawn at the zoom they were last drawn at; after a zoom settles they are drawn again at
    // the new one, so the flecks keep their size on screen (in between they scale with the board, hard-edged).
    new MutationObserver(() => {
      const z = this.viewport.style.getPropertyValue('--canvas-zoom');
      if (z === this.seenZoom) return; this.seenZoom = z;
      clearTimeout(this.zoomTimer); this.zoomTimer = setTimeout(() => { if (this.layer && !this.layer.hidden && this.layer.querySelector('.pointing-swath')) this.renderMarks(); }, 160);
    }).observe(this.viewport, {attributes: true, attributeFilter: ['style']});
    // The rail's Point and type key, pressed while the mode is off: the press is the mode's alone, so an open Inspector,
    // comments panel or menu takes it for neither a click-away nor a focus move (brief § 1: the user's panels stay as they are).
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
    // The caret is kept so keys typed after focus went elsewhere land where the user left off. selectionchange arrives
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
    this.cancelGesture(); this.wandLast = null; this.sparks = [];
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
    this.boardSheet = sheet; this.boardCtx = this.ctx;
    // The pointer left the board (onto the bar, the header, a panel): the wand's ring and the hover outline go with it.
    sheet.addEventListener('pointerleave', () => { if (this.gesture) return; this.pointer = null; this.hover = null; this.schedule(); });
    new ResizeObserver(() => { if (this.active) this.sizeSheet(); }).observe(this.viewport);
  }
  sizeSheet() {
    const r = (this.reader ? this.reader.info.stage : this.viewport).getBoundingClientRect(), dpr = devicePixelRatio || 1;
    this.sheetRect = r;
    Object.assign(this.sheet.style, {left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`});
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (this.sheet.width !== w || this.sheet.height !== h) { this.sheet.width = w; this.sheet.height = h; }
    this.dpr = dpr;
    this.draw();
  }
  // Board <-> screen. One layout read per frame or press: #world's box and the zoom.
  view() {
    if (this.reader) return this.reader.view();
    return this.boardView();
  }
  boardView() {
    const w = this.world.getBoundingClientRect(), o = this.board.origin || {x: 0, y: 0};
    return {left: w.left, top: w.top, zoom: this.board.hooks.zoom?.() || 1, ox: o.x, oy: o.y};
  }
  toBoard(x, y, v = this.view()) { return {x: (x - v.left) / v.zoom - v.ox, y: (y - v.top) / v.zoom - v.oy}; }
  toScreen(x, y, v) { return [v.left + (x + v.ox) * v.zoom - this.sheetRect.left, v.top + (y + v.oy) * v.zoom - this.sheetRect.top]; }

  // What can be pointed at, as rendered now, in board units.
  candidates(v = this.view()) {
    if (this.reader) return this.reader.candidates();
    return this.boardCandidates(v);
  }
  boardCandidates(v = this.boardView()) {
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
    if (this.reader) return this.reader.thingAt(x, y, list);
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
    if (c.reader) return this.reader?.target(t, boardId) || null;
    if (c.kind === 'placement') {
      const item = c.item, frac = t.region || (t.spot ? {...t.spot, w: 0, h: 0} : null), content = frac && this.contentOf(c, frac);
      return {kind: 'placement', id: c.id, boardId, ...(item?.id ? {itemId: item.id} : {}), itemKind: kindOf(item), title: clip(item?.title || 'Untitled', 120),
        whole: t.whole, ...(t.region ? {region: t.region} : {}), ...(t.spot ? {spot: t.spot} : {}), ...(content ? {content} : {}), ...(t.element ? {element: t.element} : {}),
        ...(t.elements?.length >= 2 ? {elements: t.elements.slice(0, 12)} : {}), ...(t.text ? {text: t.text} : {})};
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
  // Where the user pointed in the item's own content (CONTRACT "Added after the review"), from `frac` (fractions of the card's
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
    if (this.active || this.board.mode !== 'canvas') return;
    // The opened item is a place to point at too (pointing-reader.js); any other dialog over the board is not.
    const info = this.board.hooks.reader?.() || null;
    if (!info && document.querySelector('#reader-dialog[open]')) return;
    this.active = true; this.sent = null;
    this.boardId = this.board.snapshot.id;
    this.savedView = null; this.savedReader = null;
    this.returnFocus = document.activeElement;
    document.body.classList.add('pointing-on');
    this.bar.hidden = false;
    this.hoverList = null; this.hover = null; this.hoverSnap = null;
    // The @ list is made on first use, so a board that never points has only the comment card's.
    this.picker ||= attachPicker(this.field, this.board, {onChange: () => this.adoptPicked(), first: () => this.pickFirst()});
    this.goTo(info);
    pointingGuard.handler = this.onGuard;
    this.readerKey?.setAttribute('aria-pressed', 'true');
    this.syncSelectionKey();
    this.focusField();
    this.saveSoon();
    this.announce(this.reader ? `Pointing on, inside ${this.reader.name()}. Type your message and point at it; Escape leaves.` : 'Pointing on. Type your message and point at the board; Escape leaves.');
  }
  // The place the user points at: the opened item (`info`, canvas.js hooks.reader()) or the board. The composer, the draft
  // and its chips go with the user's; each place keeps the view it had when the user first pointed there, for leaving.
  goTo(info) {
    this.cancelGesture();
    const same = this.reader && info && this.reader.info.frame === info.frame;
    if (same) this.reader.refresh(info);
    else if (this.reader) { this.unlockReader(); this.reader.destroy(); this.reader = null; }
    if (info && !this.reader) this.reader = new ReaderPlace(this, info);
    const r = this.reader;
    if (r) {
      // Inside the reader's modal dialog (the page behind is inert); the board's sheet and marks wait behind it.
      if (this.bar.parentElement !== info.dialog) info.dialog.append(this.bar);
      this.boardSheet.hidden = true; this.layer.hidden = !this.sent;
      this.sheet = r.sheet; this.ctx = r.ctx; this.sheet.hidden = false; this.sheet.dataset.tool = this.tool;
      // Zooming out never leaves the item while pointing (as on the board); leaving the mode gives it back.
      info.canvas.locked = true; info.canvas.gate?.reset?.(); info.canvas.apply?.();
      if (!this.savedReader || this.savedReader.key !== r.key) this.savedReader = {key: r.key, frame: info.frame, view: {...info.canvas.view}, fitted: info.canvas.fitted, expanded: !!info.canvas.expanded, scroll: r.scroll()};
    } else {
      const footer = document.querySelector('.canvas-footer');
      if (footer && this.bar.nextElementSibling !== footer) footer.before(this.bar);
      this.sheet = this.boardSheet; this.ctx = this.boardCtx; this.sheet.hidden = false; this.layer.hidden = false; this.sheet.dataset.tool = this.tool;
      if (!this.savedView) this.savedView = this.board.hooks.currentView?.() || null;
    }
    this.hoverList = null; this.hover = null; this.hoverSnap = null; this.wandLast = null; this.sparks = [];
    this.sizeSheet(); this.renderMarks();
    if (r) { r.syncLayer(); this.prepareFor(r.candidates()[0]); }
  }
  unlockReader() {
    const cv = this.reader?.info.canvas; if (!cv) return;
    cv.locked = false; cv.apply?.();
  }
  // canvas.js: the reader opened, closed, stepped to another item or version, or its content loaded again.
  readerChanged() {
    if (!this.active) return;
    const info = this.board.hooks.reader?.() || null;
    if (!info && !this.reader) return;
    if (info && this.reader && this.reader.info.frame === info.frame) {
      const key = this.reader.key;
      this.reader.refresh(info);
      if (key !== this.reader.key) { this.savedReader = null; this.goTo(info); this.announce(`Pointing inside ${this.reader.name()}.`); return; }
      this.hoverList = null; this.renderMarks(); this.reader.syncLayer();
      return;
    }
    this.goTo(info);
    this.announce(this.reader ? `Pointing inside ${this.reader.name()}.` : 'Pointing at the board.');
    if (this.active) this.focusField();
  }
  leave() {
    if (!this.active) return;
    this.cancelGesture();
    this.picker?.close();
    this.active = false;
    pointingGuard.handler = null;
    this.readerKey?.setAttribute('aria-pressed', 'false');
    document.body.classList.remove('pointing-on');
    this.bar.hidden = true; this.boardSheet.hidden = true; this.layer.hidden = !this.sent;
    this.hover = null; this.hoverSnap = null; this.sparks = []; this.wandLast = null;
    const r = this.reader, sr = this.savedReader;
    if (r) {
      // The reader's view as it was when the user started pointing here: zoom, pan and the content's scroll.
      const cv = r.info.canvas;
      this.unlockReader();
      if (sr && sr.key === r.key && sr.frame === r.info.frame && sr.expanded === !!cv.expanded) {
        const v = cv.view, w = sr.view;
        if (Math.abs(v.zoom - w.zoom) > 1e-6 || Math.abs(v.x - w.x) > .5 || Math.abs(v.y - w.y) > .5) {
          cv.stopGlide?.(); cv.fitted = sr.fitted;
          if (sr.fitted) cv.rest(); else { cv.view = {...w}; cv.apply(); }
        }
        const now = r.scroll();
        if (Math.abs(now.x - sr.scroll.x) > .5 || Math.abs(now.y - sr.scroll.y) > .5) r.scrollTo(sr.scroll);
      }
      r.destroy(); this.reader = null;
      this.sheet = this.boardSheet; this.ctx = this.boardCtx;
    }
    const footer = document.querySelector('.canvas-footer');
    if (footer && this.bar.nextElementSibling !== footer) footer.before(this.bar);
    const v = this.savedView, now = this.board.hooks.currentView?.();
    if (!this.board.hooks.reader?.() && v && now && this.board.snapshot.id === this.boardId && (Math.abs(v.zoom - now.zoom) > 1e-6 || Math.abs(v.x - now.x) > .5 || Math.abs(v.y - now.y) > .5)) this.board.hooks.restoreView?.(v);
    this.savedView = null; this.savedReader = null;
    const back = this.returnFocus, info = this.board.hooks.reader?.();
    if (back?.isConnected && back !== document.body && (!info || info.dialog.contains(back))) back.focus({preventScroll: true});
    else if (info) info.stage.focus({preventScroll: true});
    else this.viewport.focus({preventScroll: true});
    this.saveSoon();
    this.announce('Pointing off.');
  }
  announce(text) {
    // Inside the reader its own announcer speaks (the board's is inert behind the modal dialog).
    const live = document.getElementById(this.reader || document.querySelector('#reader-dialog[open]') ? 'reader-view-announce' : 'view-announce'); if (live) live.textContent = text;
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
  // The panel, menu, dialog or field `t` is in that keeps its own keys; inside the reader, the reader's dialog itself
  // is the place the user points at, not one of those.
  owned(t, sel) {
    const hit = t?.closest?.(sel);
    if (!hit || (this.reader && hit === this.reader.info.dialog)) return null;
    return hit;
  }
  key(e) {
    if (e.isComposing || e.keyCode === 229) return false;
    if (e.key === RAW_KEY) { this.setRaw(true); return false; }
    const inField = this.field.contains(e.target), inBar = this.bar.contains(e.target);
    // Tools: ⌥ + letter, by key position (⌥M types µ on a Mac), from anywhere.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const tool = TOOLS.find(t => t.code === e.code);
      if (tool) { e.preventDefault(); if (!e.repeat) this.setTool(tool.id); return true; }
      // ⌥[ ⌥]: the wand's band narrower, wider (the brush-size keys of image editors, with ⌥ since plain ones type).
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') { e.preventDefault(); this.sizeWand(e.code === 'BracketRight' ? 1 : -1); return true; }
      // ⌥R: a reference to what is selected on the board (else the item that had focus), without a pointer.
      if (e.code === 'KeyR') { e.preventDefault(); if (!e.repeat) this.pointSelection(); return true; }
      // Zoom without leaving the composer: ⌥ with the board's + − 0, and ⌥1 fits the board.
      if (ZOOM[e.code] && !inPopup(e)) {
        e.preventDefault();
        if (!e.repeat || ZOOM[e.code] === '+' || ZOOM[e.code] === '-') { if (this.reader) this.reader.info.zoom?.(ZOOM[e.code], e.repeat); else this.board.hooks.zoomKey?.(ZOOM[e.code]); this.hoverList = null; this.schedule(); }
        return true;
      }
    }
    if (e.key === 'Escape') {
      if (this.gesture) { e.preventDefault(); this.cancelGesture(); return true; }
      if (this.picker?.open) { e.preventDefault(); this.picker.close(); return true; }
      if (inPopup(e)) return false;
      if (!inField && !inBar && this.owned(e.target, '[role=dialog],dialog,.calm-side,.board-map,.feedback-panel,.project-navigator')) return false;
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
    // Inside the opened item, a key of the reader's own (Up, Previous, Next, its zoom keys) keeps Tab, Enter, Space
    // and arrows while it has focus; letters go to the composer.
    if (this.reader && e.target !== this.reader.info.dialog && this.reader.info.dialog.contains(e.target) && e.target.closest?.('button,a[href],[role=button],[role=tab],[role=radio],select,input')
      && ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return false;
    // Focus elsewhere: in a panel, menu, dialog or field it stays theirs; on the board, keys go to the composer and
    // never to the board's own shortcuts (Delete, ⌘Z, letters).
    if (inPopup(e) || this.owned(e.target, `${FIELD},[role=dialog],dialog,[role=menu],[role=listbox],ui-popover-content`)) return false;
    // On the map or a side panel (not in one of its fields or menus), their keys stay theirs; a letter is typing, and
    // goes to the composer rather than being lost there.
    if (this.owned(e.target, '.calm-side,.board-map,.feedback-panel,.project-navigator') && (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.key === ' ')) return false;
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
    this.setRaw(rawHeld(e));
    this.hoverSnap = null;
    this.gesture = {id: e.pointerId, tool: this.tool, pan, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY,
      start: p, at: this.stamp(e.timeStamp), t0: e.timeStamp, moved: false, len: 0, ext: 0, px: e.clientX, py: e.clientY,
      points: [[p.x, p.y]], list: pan ? null : this.candidates(v), version: 0};
    if (this.tool === 'wand' && !pan) {
      // A press where the last wand drag ended, soon and before any typing, carries that reference on (a lift mid-wave).
      const last = this.wandLast, mark = last && this.marks.get(last.id);
      const again = mark && performance.now() - last.t < WAND_SESSION && Math.abs(last.zoom - v.zoom) < 1e-6 && placeKey(mark.place) === this.here()
        && this.field.querySelector(`[data-mark="${mark.id}"]`) && this.carriesOn(last, mark, e.clientX, e.clientY, p, v, this.gesture.list);
      const g = this.gesture;
      if (again) { g.field = last.field; g.continues = mark.id; g.at = mark.at; }
      else g.field = new SwathField({width: this.wandWidth / v.zoom, cell: WAND.pitch / v.zoom});
      g.field.add(p.x, p.y, performance.now());
      this.sparks = [];
    }
    this.sheet.classList.toggle('pointing-panning', pan && this.tool !== 'point' || false);
  }
  // Where the user points now: 'board', or the opened item and version ('item:<id>:<version>').
  here() { return this.reader ? this.reader.key : 'board'; }
  move(e) {
    const g = this.gesture;
    this.pointer = {x: e.clientX, y: e.clientY}; this.lastMove = performance.now();
    if (rawHeld(e) !== this.raw) this.setRaw(rawHeld(e));
    if (!g || g.id !== e.pointerId) {
      if (this.tool === 'wand') this.shed(e);
      else this.hoverAt(e.clientX, e.clientY);
      return;
    }
    const coalesced = e.getCoalescedEvents?.(), events = coalesced?.length ? coalesced : [e];
    for (const ev of events) { g.len += Math.hypot(ev.clientX - g.px, ev.clientY - g.py); g.px = ev.clientX; g.py = ev.clientY; g.ext = Math.max(g.ext, Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0)); }
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 4) { g.moved = true; if (g.pan) this.sheet.classList.add('pointing-panning'); }
    if (g.pan) {
      if (g.moved) {
        const dx = e.clientX - g.lastX, dy = e.clientY - g.lastY;
        // In the opened item a drag moves the content under the hand (its scroll), then the window (the reader's pan).
        if (this.reader) { const left = this.reader.scrollBy(e.clientX, e.clientY, -dx, -dy); if (left.dx || left.dy) this.reader.info.canvas.panBy(-left.dx, -left.dy); this.schedule(); }
        else this.board.hooks.shiftViewport?.(dx, dy);
      }
      g.lastX = e.clientX; g.lastY = e.clientY;
      return;
    }
    const v = this.view();
    if (g.tool === 'lasso') for (const ev of events) { const p = this.toBoard(ev.clientX, ev.clientY, v); g.points.push([p.x, p.y]); }
    else if (g.tool === 'wand') { const now = performance.now(); for (const ev of events) { const p = this.toBoard(ev.clientX, ev.clientY, v); g.field.add(p.x, p.y, now); } }
    g.current = this.toBoard(e.clientX, e.clientY, v);
    g.version++;
    this.schedule();
  }
  up(e) {
    const g = this.gesture; if (!g || g.id !== e.pointerId) return;
    this.gesture = null;
    this.sheet.classList.remove('pointing-panning');
    try { this.sheet.releasePointerCapture(e.pointerId); } catch {}
    const end = this.stamp(e.timeStamp), raw = this.raw || rawHeld(e);
    if (g.pan) { if (!g.moved && this.tool === 'point' && e.button === 0) this.pointAt(e.clientX, e.clientY, g.at, end, 'point', raw); this.schedule(); return; }
    if (!g.continues && this.slip(g, e)) { this.pointAt(e.clientX, e.clientY, g.at, end, g.tool, raw); this.schedule(); return; }
    if (g.tool === 'wand' && !g.continues && this.dash(g, e)) { this.announce('Too quick to point: a fast straight dash is not a reference.'); this.schedule(); return; }
    const v = this.view(), empty = this.reader ? 'Area' : 'Board area';
    if (g.tool === 'marquee') {
      const a = g.start, b = this.toBoard(e.clientX, e.clientY, v);
      const rect = {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y)};
      const shape = {kind: 'rect', x: ROUND(rect.x), y: ROUND(rect.y), w: ROUND(rect.w), h: ROUND(rect.h)};
      const geom = {kind: 'rect', ...rect}, hits = rectHits(rect, g.list);
      this.commitGesture('marquee', hits, null, geom, () => this.addMark({tool: 'marquee', at: g.at, end, shape, ...this.resolve('marquee', hits, polygonArea([[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h]]), raw, null, geom), empty}));
    } else if (g.tool === 'lasso') {
      const points = simplify(g.points, 1 / v.zoom, 400);
      if (points.length >= 3 && boundsOf(points).w * v.zoom + boundsOf(points).h * v.zoom > 12) {
        const geom = {kind: 'path', points}, hits = pathHits(points, g.list);
        this.commitGesture('lasso', hits, null, geom, () => this.addMark({tool: 'lasso', at: g.at, end, shape: {kind: 'path', points: points.map(([x, y]) => [ROUND(x), ROUND(y)])}, ...this.resolve('lasso', hits, polygonArea(points), raw, null, geom), empty}));
      } else this.pointAt(e.clientX, e.clientY, g.at, end, 'lasso', raw);
    } else if (g.tool === 'wand') this.cast(g, end, raw, e);
    this.schedule();
  }
  // A released gesture is taken at once, unless a source that answers later (the pixel source's worker) has not yet
  // answered for it: then it waits for that answer, at most LATE ms (CONTRACT § Round 2, after phase A), and commits
  // with what there is. Gestures commit in the order the user made them, and a chip lands where the caret was at release.
  commitGesture(tool, hits, field, geom, finish) {
    const late = this.raw ? [] : this.lateRequests(tool, hits, field, geom);
    if (!late.length && !this.waiting) { finish(); return; }
    const caret = this.caretNow(), place = this.here();
    this.waiting++;
    this.commits = this.commits.then(async () => {
      const answers = new Map();
      let timer = 0;
      await Promise.race([
        Promise.all(late.map(async ({entry, req}) => { try { answers.set(entry, await entry.source.proposeAsync(req)); } catch {} })),
        new Promise(r => { timer = setTimeout(r, LATE); }),
      ]);
      clearTimeout(timer);
      this.waiting--;
      if (!this.active || this.here() !== place) return; // the user left the place in between: nothing to name it with
      this.late = answers; this.insertAt = caret;
      try { finish(); } finally { this.late = null; this.insertAt = null; this.schedule(); }
    });
  }
  // The sources that answer later and have no answer for this gesture yet: their requests.
  lateRequests(tool, hits, field, geom) {
    const out = [];
    for (const r of this.innerRequests(tool, hits, field, geom)) {
      if (!r.entry.late) continue;
      let now = null; try { now = r.entry.source.propose(r.req); } catch {}
      if (!now) out.push(r);
    }
    return out;
  }
  // The caret as it is now, to put a late chip where the user was.
  caretNow() {
    const s = getSelection();
    if (document.activeElement === this.field && s.rangeCount && this.field.contains(s.anchorNode)) return s.getRangeAt(0).cloneRange();
    return this.caret && this.field.contains(this.caret.startContainer) ? this.caret.cloneRange() : null;
  }
  // A press that never really moved (a slip of the hand): a click.
  slip(g, e) {
    g.len += Math.hypot(e.clientX - g.px, e.clientY - g.py); g.ext = Math.max(g.ext, Math.hypot(e.clientX - g.x0, e.clientY - g.y0));
    return g.ext < SLIP && g.len < 2 * SLIP;
  }
  // A wand drag that is the hand moving with the button down: straight, quick, long, and released off anything.
  dash(g, e) {
    const ms = Math.max(1, e.timeStamp - g.t0), ends = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
    if (!(g.len > DASH.length && ends >= DASH.straight * g.len && g.len / ms > DASH.speed)) return false;
    const v = this.view();
    return !this.thingAt(e.clientX, e.clientY, g.list || this.candidates(v), v);
  }
  // Whether a new wand press carries the last reference on (a lift mid-wave): close to where the drag ended, further
  // along the line it was travelling, or on a thing the reference points at (inside the opened item, on the part it
  // snapped to).
  carriesOn(last, mark, x, y, p, v, list) {
    const dx = x - last.x, dy = y - last.y, d = Math.hypot(dx, dy), w = this.wandWidth;
    if (d <= w / 2) return true;
    if (d <= WAND_REACH * w && last.dir && Math.abs(dx * last.dir[0] + dy * last.dir[1]) >= 0.8 * d) return true;
    if (this.reader) {
      const s = mark.snap?.shape; if (!s) return false;
      return s.kind === 'rect' ? p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h : inRings([p.x, p.y], s);
    }
    const hit = this.thingAt(x, y, list || this.candidates(v), v);
    return !!hit && mark.targets.some(t => `${t.kind}:${t.id}` === hit.key);
  }
  cancelGesture() {
    if (!this.gesture) return;
    try { this.sheet.releasePointerCapture(this.gesture.id); } catch {}
    this.gesture = null; this.sheet?.classList.remove('pointing-panning');
    this.schedule();
  }
  // A wand drag ends: the area it swept is one reference. Its shape is the centre line and the band's width (the
  // field rebuilds the same area from it, loops filled); targets come from the area, then snapping. A drag that carried
  // a reference on (a lift mid-wave) updates that mark and its chip in place.
  cast(g, end, raw, e) {
    const f = g.field;
    let shape = f.shape(ROUND);
    if (shape.points.length > 400) shape = {...shape, points: simplify(f.points, f.cell / 4, 400).map(([x, y]) => [ROUND(x), ROUND(y)])};
    if (shape.points.length < 2) shape.points.push([...shape.points[0]]);
    const hits = areaHits(f, g.list), geom = {kind: 'swath', width: f.width, points: f.points.slice()};
    const v = this.view(), at = {x: e.clientX, y: e.clientY};
    this.commitGesture('wand', hits, f, geom, () => {
      const got = this.resolve('wand', hits, f.area(), raw, f, geom);
      if (got.snap) this.settle = {field: f, t0: performance.now(), place: this.here()};
      const prior = g.continues && this.marks.get(g.continues);
      let mark = prior;
      if (prior) {
        const targets = got.hits.targets.map(t => this.target(t)).filter(Boolean);
        Object.assign(prior, {shape, end: Math.max(prior.at, end), targets, more: got.hits.more, boxes: got.hits.targets.map(t => dataBox(t.candidate.placement || t.candidate.decoration)),
          label: this.markLabel(targets, got.hits.more, this.reader ? this.reader.emptyLabel(false, !targets.length) : 'Board area', got.snap, prior.place)});
        if (got.snap) prior.snap = got.snap; else delete prior.snap;
        if (!prior.place) { if (got.snap && got.snap.source !== 'object' && targets.length === 1) prior.where = targets[0].title; else delete prior.where; }
        const chip = this.field.querySelector(`[data-mark="${prior.id}"]`);
        if (chip) { chip.querySelector('.cref-label').textContent = clip(prior.label, 32); chip.dataset.tip = describe(prior); }
        this.renderMarks(); this.saveSoon(); this.announce(`${prior.n}: ${describe(prior)}`);
      } else mark = this.addMark({tool: 'wand', at: g.at, end, shape, ...got, empty: this.reader ? 'Area' : 'Board area'});
      if (mark) this.wandLast = {id: mark.id, field: f, t: performance.now(), x: at.x, y: at.y, zoom: v.zoom, dir: travel(f.points, 40 / v.zoom)};
    });
  }
  // Snapping: the best proposal (board objects, and sources inside the one card under the gesture) unless the user holds the
  // take-what-I-drew key. Returns {hits, snap}: the targets to keep (the snapped ones when it snapped) and the record's
  // `snap` ({source, label, shape}), or the raw hits and no snap. `geom` is the gesture (gestureGeometry).
  resolve(tool, hits, gestureArea, raw, field = null, geom = this.gestureGeometry(tool, field)) {
    const best = raw ? null : this.proposal(tool, hits, gestureArea, field, geom);
    const snap = best ? {source: best.source, label: clip(best.label, 120), shape: best.shape.kind === 'rect' ? {kind: 'rect', x: ROUND(best.shape.x), y: ROUND(best.shape.y), w: ROUND(best.shape.w), h: ROUND(best.shape.h)}
      : {kind: 'path', points: best.shape.points.slice(0, 400).map(([x, y]) => [ROUND(x), ROUND(y)]), ...(best.shape.rings ? {rings: best.shape.rings.map(r => r.map(([x, y]) => [ROUND(x), ROUND(y)]))} : {})}} : null;
    if (this.reader) return this.resolveInside(hits, best, snap, geom, field);
    if (!best) {
      // A part of one document card, unsnapped: the words the user's gesture holds.
      const t = hits.targets.length === 1 && !hits.more && !hits.targets[0].whole ? hits.targets[0] : null, doc = t && geom && geom.kind !== 'point' && this.cardDocument(t.candidate);
      const text = doc && this.textFor(doc, geom, null, null, field, geom.kind === 'rect' ? geom : boundsOf(geom.kind === 'swath' ? geom.points.flatMap(([x, y]) => [[x - geom.width / 2, y - geom.width / 2], [x + geom.width / 2, y + geom.width / 2]]) : geom.points));
      return {hits: text ? {...hits, targets: [{...t, text}]} : hits, snap: null};
    }
    if (best.targets) return {hits: {targets: best.targets, more: 0}, snap};
    // A source inside one card: that card, the part it snapped to (and the element, when it names one).
    const c = best.candidate, b = best.shape.kind === 'rect' ? best.shape : boundsOf(outlinePointsOf(best.shape));
    const f = v => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    const x = f((b.x - c.x) / c.w), y = f((b.y - c.y) / c.h);
    const region = {x, y, w: Math.min(1 - x, f(b.w / c.w)), h: Math.min(1 - y, f(b.h / c.h))};
    const doc = geom && this.cardDocument(c), text = doc && this.textFor(doc, geom, snap, best, field, b);
    return {hits: {targets: [{candidate: c, whole: false, region, ...(best.element ? {element: best.element} : {}), ...(best.elements ? {elements: best.elements} : {}), ...(text ? {text} : {})}], more: 0}, snap};
  }
  // Inside the opened item every reference is the item itself, and where in it: the snapped element (or the part the user's
  // gesture covers), in the content's own units, with the element the DOM source named and, in a document or a note,
  // the text it holds.
  resolveInside(hits, best, snap, geom, field) {
    const c = hits.targets[0]?.candidate;
    if (!c || !geom) return {hits: {targets: [], more: 0}, snap: null};
    const e = {x: c.x, y: c.y, w: c.w, h: c.h};
    const raw = geom.kind === 'point' ? {x: geom.x, y: geom.y, w: 0, h: 0} : geom.kind === 'rect' ? geom : boundsOf(geom.kind === 'swath' ? geom.points.flatMap(([x, y]) => [[x - geom.width / 2, y - geom.width / 2], [x + geom.width / 2, y + geom.width / 2]]) : geom.points);
    const clipTo = b => { const x0 = Math.max(e.x, b.x), y0 = Math.max(e.y, b.y), x1 = Math.min(e.x + e.w, b.x + b.w), y1 = Math.min(e.y + e.h, b.y + b.h); return {x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0)}; };
    const box = clipTo(best ? (best.shape.kind === 'rect' ? best.shape : boundsOf(outlinePointsOf(best.shape))) : raw);
    const text = this.textFor(this.reader.current().article ? {article: this.reader.current().article, toUnits: null} : null, geom, snap, best, field, box);
    return {hits: {targets: [{candidate: c, whole: false, box, ...(best?.element ? {element: best.element} : {}), ...(best?.elements ? {elements: best.elements} : {}), ...(text ? {text} : {})}], more: 0}, snap};
  }
  // The words a gesture points at in a document or a note: the snapped block's own words, else the characters inside
  // the snap (or the user's gesture). `where`: {article, toUnits} (null toUnits: the opened item's own mapping).
  textFor(where, geom, snap, best, field, box) {
    if (!where?.article || (geom.kind === 'point' && !best?.element)) return null;
    const s = snap?.shape;
    const inside = s?.kind === 'rect' ? (x, y) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h
      : s?.kind === 'path' ? (x, y) => inRings([x, y], s)
      : geom.kind === 'rect' ? (x, y) => x >= geom.x && x <= geom.x + geom.w && y >= geom.y && y <= geom.y + geom.h
      : geom.kind === 'path' ? (x, y) => pointInPolygon([x, y], geom.points)
      : geom.kind === 'swath' && field ? (x, y) => field.contains([x, y]) : null;
    const block = best?.element && !best.elements && BLOCKS.has(best.element.tag) ? best.element : null;
    const rect = s?.kind === 'rect' ? s : !s && geom.kind === 'rect' ? geom : null;
    // A wand underline (one flat pass, no loop) holds the line of words just above its centre line, not everything
    // under its wide band (which reaches the next line down).
    const underline = geom.kind === 'swath' && field && !field.loops && flatStroke(geom.points, geom.width) ? {points: geom.points, near: 0.3 * geom.width} : null;
    const opts = {inside, rect, underline, bounds: underline ? growBox(box, geom.width) : box, element: block && (geom.kind === 'point' || !inside) ? block : null};
    try { return where.toUnits ? textRangeIn(where.article, where.toUnits, opts) : this.reader.textRange(opts); } catch { return null; }
  }
  // A document card on the board (a Markdown page in its frame): its column, and its page px -> board units.
  cardDocument(c) {
    if (c?.kind !== 'placement' || !c.el || !['markdown', 'text'].includes(kindOf(c.item))) return null;
    const f = resolveFrame(c.el), article = f?.doc.querySelector('.markdown, .item-text'); if (!article) return null;
    const t = toTop(f.win), v = this.boardView(); if (!t) return null;
    return {article, toUnits: (x, y) => { const p = this.toBoard(t.x + t.k * x, t.y + t.k * y, v); return [p.x, p.y]; }};
  }
  // The best snap for a gesture. On the board a source inside a card (an element in its page, an edge in its picture)
  // is what the user means when the gesture lies inside that card and the thing it found is clearly smaller than the card;
  // otherwise the best score wins, and the board-object source (the whole card) usually does. Inside the opened item
  // only the sources inside it propose (the item itself is always the thing).
  proposal(tool, hits, gestureArea, field, geom = this.gestureGeometry(tool, field)) {
    const inner = this.innerProposals(tool, hits, field, geom);
    if (tool === 'click') return this.clickProposal(inner);
    if (this.reader) return bestProposal(inner);
    const object = objectSnap(hits, {tool, gestureArea, name: c => this.snapName(c)});
    const best = bestProposal(inner);
    if (best && object && best.score >= PART_SCORE && inCard(best, geom)) return best;
    return bestProposal([object, ...inner]);
  }
  // How a snap names one thing: its kind, then its title.
  snapName(c) {
    const t = this.target({candidate: c, whole: true});
    const noun = c.kind === 'placement' ? 'card' : {line: 'arrow', text: 'text', sticky: 'sticky', container: 'container', region: 'region', shape: 'shape', sticker: 'sticker'}[t.itemKind] || 'drawing';
    // A drawn element's own words (its title starts with its kind: "Sticky · …"); one without words is named by kind.
    const own = c.decoration ? String(c.decoration.text || '').replace(/\s+/g, ' ').trim() : t.title;
    return own ? `${noun} "${clip(own, 60)}"` : noun;
  }
  /**
   * A snap source inside items (team/pointing/CONTRACT.md § Round 2, the snap-source seam). `source.propose(request)`
   * is asked when a gesture lies on one card (its only target) or inside the opened item, on the pointer's path, so it
   * answers in well under a frame (precompute off the path). The request:
   *   {kind: 'point' | 'rect' | 'path' | 'swath', geometry, item, el, placement, unit, frame?, img?}
   *   - geometry, in `unit` coordinates: {x, y} | {x, y, w, h} | {points} | {width, points};
   *   - unit 'page': CSS px of the card frame's document (scroll included), when the card shows a page in an <iframe>
   *     (`frame`); 'image': px of the picture's file, when it shows an <img> (`img`); 'card': board units from the
   *     card's top-left otherwise; inside the opened item, the item's own units (pointing-reader.js);
   *   - item: the item record; el: the card's element (the reader's frame inside the opened item); placement.
   * It answers {shape: {kind: 'rect' | 'path', …} in the same unit, label, source: 'dom' | 'pixels', score 0..1, element?,
   * elements?} or null. Options:
   *   - `space: 'board'` gives and takes board units; `map(el)` the source's own unit instead: {toPage(clientX,
   *     clientY) -> {x, y}, toClient(x, y) -> {x, y}, scale() (client px per unit)} or null (then it is not asked), e.g.
   *     pointing-snap-dom.js `pageMapping`, which follows nested item frames;
   *   - `accepts(candidate)`: whether to ask it about this card or item at all;
   *   - `prepare(candidate)`: called once per card or item, on first hover (and on pointing inside an item);
   *   - `hover: true`: asked on hover too, so the element a click would name is outlined before the click;
   *   - `late: true`: it answers later (a worker): `propose` returns what it has and asks, `proposeAsync` resolves; it
   *     calls refreshSnap() when an answer arrives, and a release waits for it at most LATE ms.
   */
  addSnapSource(source, {space = 'content', map = null, accepts = null, prepare = null, hover = false, late = false} = {}) {
    if (source?.propose) this.snapSources.push({source, space, map, accepts, prepare, hover, late});
  }
  refreshSnap() { if (this.gesture) { this.gesture.version++; this.schedule(); } }
  // The DOM source (elements in same-origin pages, on cards and in the opened item) and the pixel source (edges in
  // image items' pictures, in a worker).
  wireSources() {
    this.addSnapSource(domSnap, {map: pageMapping, hover: true, prepare: c => domSnap.prepare(c.el)});
    const picture = c => kindOf(c.item) === 'image' && (!c.reader || this.reader?.current().kind === 'image');
    pixelSnap.onReady = () => this.refreshSnap();
    this.addSnapSource(pixelSnap, {accepts: picture, prepare: c => pixelSnap.prepare(c.item, c.el), late: true});
  }
  // Ask the sources to get ready for a card or the opened item (once each).
  prepareFor(c) {
    // A card by its element; the opened item by what it shows now (its frame stays as the user steps).
    const shown = c?.reader ? this.reader?.current() : null, key = c?.reader ? shown?.img || shown?.doc : c?.el;
    if (!key || this.prepared.has(key)) return;
    this.prepared.add(key);
    for (const s of this.snapSources) if (s.prepare && (!s.accepts || s.accepts(c))) { try { s.prepare(c); } catch {} }
  }
  // Each source's request for a gesture on one card (or inside the opened item), with the way back to board units.
  innerRequests(tool, hits, field, g = this.gestureGeometry(tool, field), {hover = false} = {}) {
    if (!this.snapSources.length || !g) return [];
    const ts = hits.targets; if (ts.length !== 1 || ts[0].candidate.kind !== 'placement' || !ts[0].candidate.el) return [];
    const c = ts[0].candidate, out = [];
    for (const entry of this.snapSources) {
      if (hover && !entry.hover) continue;
      if (entry.accepts && !entry.accepts(c)) continue;
      const {space, map} = entry;
      const local = space === 'board' ? null : map ? this.mappedFrame(c, map) : this.localFrame(c);
      if (map && !local) continue;
      const to = local ? local.toLocal : p => p, back = local ? local.toBoard : p => p;
      const k = local ? local.scale : 1;
      const geometry = g.kind === 'point' ? (([x, y]) => ({x, y}))(to([g.x, g.y]))
        : g.kind === 'rect' ? (([x0, y0], [x1, y1]) => ({x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0)}))(to([g.x, g.y]), to([g.x + g.w, g.y + g.h]))
        : g.kind === 'swath' ? {width: g.width * k, points: g.points.map(to)} : {points: g.points.map(to)};
      out.push({entry, c, back, req: {kind: g.kind, geometry, item: c.item, el: c.el, placement: c.placement, unit: local ? local.unit : 'board', frame: local?.frame, img: local?.img}});
    }
    return out;
  }
  innerProposals(tool, hits, field, g = this.gestureGeometry(tool, field), opts = {}) {
    const out = [];
    for (const {entry, c, back, req} of this.innerRequests(tool, hits, field, g, opts)) {
      let p = null;
      try { p = this.late?.has(entry) ? this.late.get(entry) : entry.source.propose(req); } catch (error) { console.warn('Snap source failed:', error?.message); }
      if (!p?.shape) continue;
      const rect = ([x0, y0], [x1, y1]) => ({kind: 'rect', x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0)});
      const shape = p.shape.kind === 'rect' ? rect(back([p.shape.x, p.shape.y]), back([p.shape.x + p.shape.w, p.shape.y + p.shape.h]))
        : p.shape.points?.length >= 3 ? {kind: 'path', points: p.shape.points.map(back), ...(p.shape.rings ? {rings: p.shape.rings.map(r => r.map(back))} : {})} : null;
      if (!shape) continue;
      // Inside the opened item an element's box is in the item's own units, as the rest of the mark (a document's
      // column scrolls inside its page, so its page coordinates are not the document's).
      let element = p.element, elements = p.elements;
      if (c.reader && element?.box) {
        const box = b => { const r = rect(back([b.x, b.y]), back([b.x + b.w, b.y + b.h])); return {x: ROUND(r.x), y: ROUND(r.y), w: ROUND(r.w), h: ROUND(r.h)}; };
        element = {...element, box: box(element.box)};
        if (elements) elements = elements.map(m => m.box ? {...m, box: box(m.box)} : m);
      }
      // A region found in a picture says which picture.
      const label = p.source === 'pixels' ? `part of the picture "${clip(c.item?.title || this.reader?.name() || 'Untitled', 40)}"` : p.label;
      out.push({...p, label, shape, candidate: c, ...(element ? {element} : {}), ...(elements ? {elements} : {})});
    }
    return out;
  }
  // What a click names inside a card: a part clearly smaller than the card (an element in its page, a region of its
  // picture); one that is most of the card (a document's article, a page's main) is the card itself, so the click
  // names the card. Inside the opened item every part counts (the item is already the thing).
  clickProposal(inner) {
    if (this.reader) return bestProposal(inner);
    return bestProposal(inner.filter(p => { const c = p.candidate, b = p.shape.kind === 'rect' ? p.shape : boundsOf(outlinePointsOf(p.shape)); return !(c?.w * c?.h > 0) || b.w * b.h < 0.6 * c.w * c.h; }));
  }
  // The gesture as board geometry for the sources: the live one, or the click being made (clickAt).
  gestureGeometry(tool, field) {
    const g = this.gesture;
    if (tool === 'click') return this.clickAt ? {kind: 'point', ...this.clickAt} : null;
    if (tool === 'wand' && field) return {kind: 'swath', width: field.width, points: field.points};
    if (!g) return null;
    if (tool === 'marquee' && g.current) { const a = g.start, b = g.current; return {kind: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y)}; }
    if (tool === 'lasso') return {kind: 'path', points: g.points};
    return null;
  }
  // A source's own coordinates through its mapping (client px <-> its unit).
  mappedFrame(c, map) {
    let m = null; try { m = map(c.el); } catch {} if (!m) return null;
    const v = this.view();
    return {unit: 'source', scale: v.zoom / (m.scale?.() || 1),
      toLocal: ([x, y]) => { const q = m.toPage(v.left + (x + v.ox) * v.zoom, v.top + (y + v.oy) * v.zoom); return [q.x, q.y]; },
      toBoard: ([x, y]) => { const q = m.toClient(x, y), b = this.toBoard(q.x, q.y, v); return [b.x, b.y]; }};
  }
  // A card's own coordinates for the sources: its page (iframe), its picture (img), else board units from its corner.
  // Inside the opened item the place's own units are already the picture's (image px).
  localFrame(c) {
    if (c.reader) { const img = this.reader?.current().img; return {unit: img ? 'image' : 'item', img, scale: 1, toLocal: p => p, toBoard: p => p}; }
    const v = this.view(), card = c.el, area = card.querySelector('.workspace-card-preview');
    const scr = ([x, y]) => [v.left + (x + v.ox) * v.zoom, v.top + (y + v.oy) * v.zoom];
    const brd = ([x, y]) => { const p = this.toBoard(x, y, v); return [p.x, p.y]; };
    const frame = area?.querySelector('iframe');
    if (frame?.offsetWidth > 0) {
      const r = frame.getBoundingClientRect(), k = frame.offsetWidth / r.width;
      let sx = 0, sy = 0; try { sx = frame.contentWindow?.scrollX || 0; sy = frame.contentWindow?.scrollY || 0; } catch {}
      return {unit: 'page', frame, scale: k * v.zoom, toLocal: p => { const [x, y] = scr(p); return [(x - r.left) * k + sx, (y - r.top) * k + sy]; }, toBoard: ([x, y]) => brd([r.left + (x - sx) / k, r.top + (y - sy) / k])};
    }
    const img = area?.querySelector('img');
    if (img?.naturalWidth > 0) {
      const shown = img.getBoundingClientRect(), nw = img.naturalWidth, nh = img.naturalHeight, fit = getComputedStyle(img).objectFit || 'fill';
      let cw = shown.width, ch = shown.height;
      if (fit === 'contain' || fit === 'scale-down' || fit === 'cover') { const k0 = (fit === 'cover' ? Math.max : Math.min)(shown.width / nw, shown.height / nh), k = fit === 'scale-down' ? Math.min(1, k0) : k0; cw = nw * k; ch = nh * k; }
      else if (fit === 'none') { cw = nw; ch = nh; }
      const px = shown.left + (shown.width - cw) / 2, py = shown.top + (shown.height - ch) / 2, kx = nw / cw, ky = nh / ch;
      return {unit: 'image', img, scale: kx * v.zoom, toLocal: p => { const [x, y] = scr(p); return [(x - px) * kx, (y - py) * ky]; }, toBoard: ([x, y]) => brd([px + x / kx, py + y / ky])};
    }
    return {unit: 'card', scale: 1, toLocal: ([x, y]) => [x - c.x, y - c.y], toBoard: ([x, y]) => [x + c.x, y + c.y]};
  }
  // A click: the thing under the pointer, or the board at that spot. Recorded as tool "click", the active tool in `via`.
  pointAt(x, y, at, end, via, raw = this.raw) {
    const v = this.view(), list = this.candidates(v), p = this.toBoard(x, y, v), hit = this.thingAt(x, y, list, v);
    // The whole thing under the click, with the spot the user clicked (a part needs a drag); a source inside the card may
    // snap it to the element clicked.
    const hits = {targets: hit ? [pointTarget(hit, p)] : [], more: 0}, geom = {kind: 'point', x: p.x, y: p.y};
    const make = () => this.addMark({tool: 'click', via, at, end, shape: {kind: 'point', x: ROUND(p.x), y: ROUND(p.y)},
      ...(hit ? this.resolve('click', hits, 0, raw, null, geom) : {hits, snap: null}), empty: this.reader ? 'Point' : 'Board point'});
    if (hit) this.commitGesture('click', hits, null, geom, make); else make();
  }
  // The pointer at rest over the board or the item: what a click would point at is outlined, dashed (the card; inside a
  // live card or the opened item, the element the DOM source would name). The sources get ready on first hover.
  hoverAt(x, y) {
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      if (!this.active || this.gesture || !this.pointer) return;
      const v = this.view(), hit = this.thingAt(this.pointer.x, this.pointer.y, this.hoverList ||= this.candidates(v), v);
      if (hit) this.prepareFor(hit);
      let snap = null;
      if (hit && !this.raw && hit.kind === 'placement') {
        const p = this.toBoard(this.pointer.x, this.pointer.y, v);
        snap = this.clickProposal(this.innerProposals('click', {targets: [pointTarget(hit, p)], more: 0}, null, {kind: 'point', x: p.x, y: p.y}, {hover: true}));
      }
      const key = hit?.key || null, skey = snap ? JSON.stringify(snap.shape) : '';
      if (key !== this.hover?.key || skey !== (this.hoverSnapKey || '')) { this.hover = hit; this.hoverSnap = snap; this.hoverSnapKey = skey; this.draw(v); }
    });
  }
  // The wand moving without the button: a few sparkles shed behind the tip, gone within half a second (the user's motion
  // only; nothing is left behind and nothing points).
  shed(e) {
    const coalesced = e.getCoalescedEvents?.(), events = coalesced?.length ? coalesced : [e], now = performance.now(), r = this.sheetRect;
    for (const ev of events) {
      const d = Math.hypot(ev.clientX - (this.lastShed?.[0] ?? ev.clientX), ev.clientY - (this.lastShed?.[1] ?? ev.clientY));
      this.lastShed = [ev.clientX, ev.clientY];
      if (Math.random() > Math.min(0.9, d / 10)) continue;
      const a = Math.random() * Math.PI * 2, rr = Math.random() * this.wandWidth * 0.32;
      this.sparks.push([ev.clientX - r.left + rr * Math.cos(a), ev.clientY - r.top + rr * Math.sin(a), now, 160 + Math.random() * 300, Math.random()]);
    }
    if (this.sparks.length > 160) this.sparks.splice(0, this.sparks.length - 160);
    this.schedule();
  }
  setRaw(on) {
    on = !!on; if (on === this.raw) return;
    this.raw = on;
    if (this.gesture) { this.gesture.version++; this.schedule(); }
  }
  sizeWand(step) {
    const sizes = WAND.sizes, i = sizes.indexOf(this.wandWidth), next = sizes[Math.max(0, Math.min(sizes.length - 1, (i < 0 ? sizes.indexOf(WAND.width) : i) + step))];
    const end = next === sizes[0] ? ', the narrowest' : next === sizes.at(-1) ? ', the widest' : '';
    // Already at an end: nothing changes on screen, so the bar's line says so.
    if (next === this.wandWidth) { this.notify(`The wand is at its ${step < 0 ? 'narrowest' : 'widest'}, ${next} px.`); return; }
    this.wandWidth = next; this.wandLast = null;
    try { localStorage.setItem(SIZE_STORE, String(next)); } catch {}
    if (this.notice) { this.notice = null; this.syncStatus(); }
    this.announce(`Wand ${next} px wide${end}.`);
    this.schedule();
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
  addMark({tool, via, at, end, shape, snap = null, hits, empty}) {
    if (this.full()) return null;
    const kept = hits.targets.map(t => [t, this.target(t)]).filter(([, t]) => t), targets = kept.map(([, t]) => t);
    const n = this.newN();
    const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    // Inside the opened item: where (the item and version, and what the user was looking at), and its name for the chip.
    const place = this.reader ? this.reader.record(this.board.snapshot.id) : null;
    // Inside the item, a mark that names nothing in it says what kind of place it is (what the agent gets), or that it
    // is outside the item.
    if (place) empty = this.reader.emptyLabel(shape.kind === 'point', !targets.length);
    const label = this.markLabel(targets, hits.more, empty, snap, place);
    // `boxes`: where each target was when the user pointed (its saved box), so the draft's marks can tell when one moved.
    const boxes = kept.map(([t]) => dataBox(t.candidate.placement || t.candidate.decoration));
    // `shape` is always what the user drew; `snap` (when it snapped) the outline it was tidied to, which targets follow.
    const picture = place && this.reader.current().kind === 'image' ? this.reader.current().img.currentSrc || this.reader.current().img.src : null;
    // `where`: the item a part was found in (the opened item, or the card a source looked inside), for chips and the body.
    const where = place ? this.reader.name() : snap && snap.source !== 'object' && targets.length === 1 ? targets[0].title : null;
    const note = place && targets.length ? this.reader.limits() : '';
    const mark = {id, n, tool, ...(via ? {via} : {}), at, end: Math.max(at, end), boardId: this.board.snapshot.id, ...(place ? {place} : {}), ...(where ? {where} : {}), ...(picture ? {picture} : {}), ...(note ? {note} : {}),
      shape, ...(snap ? {snap} : {}), targets, boxes, more: hits.more, label};
    this.marks.set(id, mark);
    this.hoverList = null;
    this.insertChip(mark);
    this.notice = null; this.syncStatus();
    this.renderMarks();
    this.saveSoon();
    this.announce(`${n}: ${describe(mark)}`);
    return mark;
  }
  // What a mark is called on its chip: on the board, what it points at; inside an item, what it snapped to (the element,
  // the region in the picture), else the words it holds, else Point or Area. The chip shows the place apart (its mark
  // made inside an item carries a small window glyph, and its hint names the item).
  markLabel(targets, more, empty, snap, place) {
    // On a card, a source inside it named a part (an element of its page, a region of its picture): that part.
    if (place?.kind !== 'item') return snap && snap.source !== 'object' && targets.length === 1 && !more ? snap.label : labelOf(targets, more, empty);
    const t = targets[0];
    if (t?.whole) return t.title;
    return snap?.label || (t?.text?.quote ? `"${clip(t.text.quote, 40)}"` : empty);
  }
  chipHTML(mark) {
    const inside = mark.place?.kind === 'item';
    return `<span class="cref pointing-chip${inside ? ' pointing-inside' : ''}" contenteditable="false" data-mark="${mark.id}" data-tip="${esc(describe(mark))}"><b class="pointing-n">${mark.n}</b>${inside ? ICON.inside : ''}<span class="cref-label">${esc(clip(mark.label, 32))}</span></span>`;
  }
  insertChip(mark) {
    // A chip that waited for a late source goes where the caret was when the gesture ended; the caret then comes back
    // to where the user is typing now.
    const at = this.insertAt && this.field.contains(this.insertAt.startContainer) ? this.insertAt : null;
    const resume = at ? this.caretNow() : null;
    this.focusField();
    if (at) { const s0 = getSelection(); s0.removeAllRanges(); s0.addRange(at.cloneRange()); }
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
    if (resume && this.field.contains(resume.startContainer) && resume.compareBoundaryPoints(Range.START_TO_START, c) > 0) { s2.removeAllRanges(); s2.addRange(resume); this.caret = resume.cloneRange(); }
  }
  // A chip the @ picker inserted becomes a mark made by the keyboard.
  adoptPicked() {
    const v = this.boardView(), list = this.boardCandidates(v), vp = this.viewport.getBoundingClientRect();
    let last = null;
    for (const chip of this.field.querySelectorAll('.cref[data-ref]:not([data-mark])')) {
      let ref; try { ref = JSON.parse(chip.dataset.ref); } catch { chip.remove(); continue; }
      if (this.full()) { chip.nextSibling?.nodeType === 3 && chip.nextSibling.nodeValue.startsWith(' ') && (chip.nextSibling.nodeValue = chip.nextSibling.nodeValue.slice(1)); chip.remove(); continue; }
      const key = ref.kind === 'item' ? `placement:${ref.placementId || (this.board.snapshot.placements.find(p => p.itemId === ref.id && !p.removedAt)?.id)}` : `${ref.kind}:${ref.id}`;
      let c = list.find(x => x.key === key);
      if (!c && ref.kind === 'board') c = list.find(x => x.item?.childBoardId === ref.id);
      const t = this.stamp(), n = this.newN(), id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const centre = this.toBoard(vp.left + vp.width / 2, vp.top + vp.height / 2, v);
      const targets = c ? [this.target({candidate: c, whole: true})]
        : ref.kind === 'board' ? [{kind: 'board', id: ref.id, boardId: this.board.snapshot.id, itemKind: 'board', title: clip(ref.label, 120), whole: true}] : [];
      const shape = c ? {kind: 'rect', x: ROUND(c.x), y: ROUND(c.y), w: ROUND(c.w), h: ROUND(c.h)} : {kind: 'point', x: ROUND(centre.x), y: ROUND(centre.y)};
      const mark = {id, n, tool: 'keyboard', at: t, end: t, boardId: this.board.snapshot.id, shape, targets, boxes: c ? [dataBox(c.placement || c.decoration)] : [], more: 0, label: targets[0]?.title || ref.label || 'Board point'};
      this.marks.set(id, mark); last = mark;
      const tpl = document.createElement('template'); tpl.innerHTML = this.chipHTML(mark);
      chip.replaceWith(tpl.content.firstElementChild);
    }
    this.renderMarks();
    if (last) { if (!this.reader) this.reveal(last); this.announce(`${last.n}: ${describe(last)}`); }
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
  // the item that had focus when the user entered. The mode never changes either.
  selectionTargets(v = this.boardView()) {
    const list = this.boardCandidates(v), keys = [...(this.board.selection || [])].map(id => `placement:${id}`);
    for (const d of this.board.whiteboard?.selectedDecorations?.() || []) keys.push(`decoration:${d.id}`);
    let from = 'Selected';
    if (!keys.length) {
      const f = this.returnFocus?.closest?.('#world .workspace-card[data-placement], #world .workspace-decoration[data-decoration]');
      if (f) { keys.push(f.dataset.placement ? `placement:${f.dataset.placement}` : `decoration:${f.dataset.decoration}`); from = 'Focused'; }
    }
    return {from, list: [...new Set(keys)].map(k => list.find(c => c.key === k)).filter(Boolean)};
  }
  syncSelectionKey() {
    // Inside the opened item, the key points at the item itself (what is shown of it).
    const none = !this.reader && !this.selectionTargets().list.length;
    this.selButton.setAttribute('aria-disabled', String(none));
    this.selButton.setAttribute('aria-label', this.reader ? 'Point at this item' : 'Point at the selection');
    this.selButton.dataset.tip = this.reader ? 'Point at this item' : none ? 'Point at the selection (nothing is selected)' : 'Point at the selection';
  }
  // A reference to the selection without a pointer (brief § 6): one mark over all of it, whole.
  pointSelection() {
    if (!this.active) return;
    if (this.reader) {
      // Inside the opened item: the item, as much of it as is shown.
      const v = this.view(), c = this.reader.candidates()[0], b = this.reader.shownBox(), t = this.stamp();
      const a = this.toBoard(b.x, b.y, v), z = this.toBoard(b.x + b.w, b.y + b.h, v);
      const r = {x: Math.max(c.x, a.x), y: Math.max(c.y, a.y)}; r.w = Math.max(0, Math.min(c.x + c.w, z.x) - r.x); r.h = Math.max(0, Math.min(c.y + c.h, z.y) - r.y);
      this.addMark({tool: 'keyboard', at: t, end: t, shape: {kind: 'rect', x: ROUND(r.x), y: ROUND(r.y), w: ROUND(r.w), h: ROUND(r.h)}, hits: {targets: [{candidate: c, whole: true}], more: 0}, empty: 'Item'});
      return;
    }
    const v = this.view(), {list} = this.selectionTargets(v);
    if (!list.length) { this.notify('Nothing is selected on the board. Select something before pointing, or type @ and its name.'); this.focusField(); return; }
    const b = boundsOf(list.flatMap(c => [[c.x, c.y], [c.x + c.w, c.y + c.h]])), t = this.stamp();
    const mark = this.addMark({tool: 'keyboard', at: t, end: t, shape: {kind: 'rect', x: ROUND(b.x), y: ROUND(b.y), w: ROUND(b.w), h: ROUND(b.h)},
      hits: {targets: list.slice(0, 12).map(c => ({candidate: c, whole: true})), more: Math.max(0, list.length - 12)}, empty: 'Board area'});
    if (mark) this.reveal(mark);
  }
  // A mark made without the pointer that is off screen: the board brings it into view (leaving puts the view back).
  reveal(mark) {
    const g = this.geometry(mark, true), pts = g.shapes.flatMap(outlinePoints);
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
      this.wandLast = null; // typing after a wand drag: the next press is a new reference
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
    const marks = sent ? sent.marks : this.chips().map(c => this.marks.get(c.dataset.mark)), here = this.here();
    this.paint(this.layer, marks, {sent, board: true});
    // Inside the opened item, its own marks (this item and version) in the reader's layer; the others stay listed as
    // chips, marked as made elsewhere.
    if (this.reader) this.paint(this.reader.layer, sent ? [] : marks.filter(m => placeKey(m.place) === here), {sent: null, board: false});
    if (!sent) for (const chip of this.chips()) {
      const m = this.marks.get(chip.dataset.mark), away = placeKey(m.place) !== here;
      if (chip.classList.contains('pointing-elsewhere') !== away) {
        chip.classList.toggle('pointing-elsewhere', away);
        if (!chip.classList.contains('missing')) chip.dataset.tip = away && !m.place ? `On the board: ${describe(m)}` : describe(m);
      }
    }
    this.layer.hidden = !(this.active || sent);
  }
  // Marks into one layer: the board's (#world, board units; a mark made inside an item shows as that item's card,
  // outlined, labelled Inside) or the reader's (inside its window, the item's own units).
  paint(layer, marks, {sent, board}) {
    const o = board ? this.board.origin || {x: 0, y: 0} : {x: 0, y: 0}, v = marks.length ? (board ? this.boardView() : this.reader.view()) : null;
    let svg = '', badges = '';
    const sparkle = [], rows = new Map();
    // Inside the opened item, a number at the window's top edge goes just inside it (above it, it would be cut off).
    const below = !board && this.reader ? (x, y) => this.reader.nearTop(x, y, 24) : () => false;
    for (const m of marks) {
      const g = board ? this.geometry(m, !sent, v) : this.drawnGeometry(m);
      const cls = `pointing-shape${sent && sent.focus === m.n ? ' pointing-focus' : ''}${g.gone ? ' pointing-gone' : ''}${g.inside ? ' pointing-inside' : ''}`;
      if (!g.shapes.length && !g.dot && !g.badge) continue;
      if (g.glitter && g.shapes.length) { sparkle.push({m, g}); } else for (const s of g.shapes) {
        if (s.kind === 'path') svg += `<path class="${cls}" data-n="${m.n}" d="${ringsOf(s).map(l => `M${l.map(([x, y]) => `${x + o.x} ${y + o.y}`).join('L')}Z`).join('')}"/>`;
        else svg += `<rect class="${cls}${s.kind === 'outline' ? ' pointing-outline' : ''}" data-n="${m.n}" x="${s.x + o.x}" y="${s.y + o.y}" width="${s.w}" height="${s.h}"/>`;
      }
      if (g.dot) badges += `<span class="pointing-dot${g.gone ? ' pointing-gone' : ''}" style="left:${g.dot.x + o.x}px;top:${g.dot.y + o.y}px"></span>`;
      // Numbers that would sit on top of each other (several marks made inside one item, two marks on one thing) go
      // side by side in one row, so no number covers another's.
      if (g.badge) {
        const key = g.inside ? `in:${m.targets.find(t => t.kind === 'placement')?.id}` : `${Math.round(g.badge.x * v.zoom / 16)}|${Math.round(g.badge.y * v.zoom / 16)}`;
        const row = rows.get(key) || rows.set(key, {x: g.badge.x, y: g.badge.y, items: []}).get(key);
        row.items.push({n: m.n, gone: g.gone, note: g.note, inside: g.inside});
      }
      if (!sent && board) { // the chip says so too
        const chip = this.field.querySelector(`[data-mark="${m.id}"]`), num = chip?.querySelector('.pointing-n');
        if (num && num.textContent !== String(m.n)) num.textContent = String(m.n); // a chip Undo brought back shows its mark's number
        if (chip && chip.classList.contains('missing') !== !!g.gone) { chip.classList.toggle('missing', !!g.gone); chip.dataset.tip = g.gone ? `Deleted: ${describe(m)}` : describe(m); }
      }
    }
    for (const row of rows.values()) {
      // "Inside" once, after the last number of its row.
      const shared = row.items.every(i => i.inside) ? 'Inside' : null;
      const one = (i, last) => { const note = shared ? (last ? shared : '') : i.note; return `<span class="pointing-badge${i.gone ? ' pointing-gone' : ''}" data-n="${i.n}"><b>${i.n}</b>${note ? `<span class="pointing-note">${esc(note)}</span>` : ''}</span>`; };
      const at = `left:${row.x + o.x}px;top:${row.y + o.y}px`, flip = below(row.x, row.y) ? ' pointing-badge-below' : '';
      if (row.items.length === 1) badges += one(row.items[0], true).replace('class="pointing-badge', `style="${at}" class="pointing-badge${flip}`);
      else badges += `<span class="pointing-badge-row${flip}" style="${at}">${row.items.sort((a, b) => a.n - b.n).map((i, k, all) => one(i, k === all.length - 1)).join('')}</span>`;
    }
    layer.innerHTML = `<svg class="pointing-marks-svg" aria-hidden="true">${svg}</svg>${badges}`;
    // Wand marks: one canvas each, in the layer's units, drawn at the current zoom and kept while what it draws is the same.
    const keep = new Map(), had = layer.glitter || new Map();
    for (const {m, g} of sparkle) {
      const c = this.glitterCanvas(m, g, v, o, had);
      if (c) { layer.prepend(c); keep.set(c.dataset.key, c); }
    }
    layer.glitter = keep;
  }
  // A mark drawn where it was made (inside the opened item: its own units, which neither move nor resize).
  drawnGeometry(m) {
    const s = m.snap?.shape || m.shape, glitter = m.tool === 'wand';
    const shapes = s.kind === 'point' ? [] : [s.kind === 'rect' ? {kind: 'rect', x: s.x, y: s.y, w: s.w, h: s.h} : s.kind === 'swath' ? {kind: 'swath', width: s.width, points: s.points} : {kind: 'path', points: s.points, ...(s.rings ? {rings: s.rings} : {})}];
    // A click that named an element outlines it; the dot is where the user clicked.
    if (m.shape.kind === 'point' && m.snap?.shape) return {shapes: [{kind: 'outline', ...(m.snap.shape.kind === 'rect' ? m.snap.shape : boundsOf(outlinePointsOf(m.snap.shape)))}], dot: {x: m.shape.x, y: m.shape.y}, badge: topLeft(m.snap.shape), note: '', gone: false, glitter: false};
    return {shapes, dot: s.kind === 'point' ? {x: s.x, y: s.y} : null, badge: s.kind === 'point' ? {x: s.x, y: s.y} : topLeft(s), note: '', gone: false, glitter, raw: rawSweep(m)};
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
  // What to draw for a mark, from where its targets are now. `then` is each target's saved box when the user pointed (the
  // draft keeps it) or when the message was sent (the server stores it as `placed`).
  // - Nothing moved: the shape exactly as the user drew it.
  // - One target, moved or resized: the shape as drawn, carried with it (same place on the object, same proportions).
  // - Otherwise (several targets moved apart, or no saved box): each target where it is now, a whole one outlined, a
  //   part as its region (fractions of the target's own box).
  // - Every target gone: the shape as drawn, plain and dashed, labelled Deleted; some gone: "1 of 3 deleted".
  // Empty space (no targets) is a board position and stays where it was drawn.
  // A snapped mark draws its snapped outline (its targets follow it); a wand mark draws as glitter (`glitter`).
  geometry(m, draft, v = this.boardView()) {
    // Made inside an item: on the board, that item's card outlined, labelled Inside (its own units mean nothing here).
    if (m.place?.kind === 'item') {
      const t = m.targets.find(x => x.kind === 'placement'), at = t && this.locate(t, v);
      if (!at || at.gone || !at.box) return {shapes: [], dot: null, badge: null, note: '', gone: !!at?.gone, glitter: false};
      return {shapes: [{kind: 'outline', ...at.box}], dot: null, badge: {x: at.box.x, y: at.box.y}, note: 'Inside', gone: false, glitter: false, inside: true};
    }
    const s = m.snap?.shape || m.shape, glitter = m.tool === 'wand';
    const drawnShapes = shape => shape.kind === 'point' ? [] : [shape.kind === 'rect' ? {kind: 'rect', x: shape.x, y: shape.y, w: shape.w, h: shape.h}
      : shape.kind === 'swath' ? {kind: 'swath', width: shape.width, points: shape.points} : {kind: 'path', points: shape.points, ...(shape.rings ? {rings: shape.rings} : {})}];
    const drawn = {shapes: drawnShapes(s), dot: s.kind === 'point' ? {x: s.x, y: s.y} : null, badge: s.kind === 'point' ? {x: s.x, y: s.y} : topLeft(s), note: '', gone: false, glitter, raw: rawSweep(m)};
    const placed = m.targets.map((t, i) => ({t, then: draft ? m.boxes?.[i] : t.placed, ...this.locate(t, v)})).filter(x => x.t.kind !== 'board');
    if (!placed.length) return drawn;
    const gone = placed.filter(x => x.gone).length;
    if (gone === placed.length) return {...drawn, gone: true, note: placed.length === 1 ? 'Deleted' : 'All deleted'};
    const live = placed.filter(x => !x.gone && x.box);
    if (!live.length) return drawn;
    const note = gone ? `${gone} of ${placed.length} deleted` : '';
    // A click names its target, outlined or as the spot clicked; the dot is where the user clicked.
    const ofTarget = ({t, box, ink}) => t.whole || !t.region ? {kind: 'outline', ...(ink || box)}
      : {kind: 'rect', x: box.x + t.region.x * box.w, y: box.y + t.region.y * box.h, w: t.region.w * box.w, h: t.region.h * box.h};
    const near = (a, b) => a && b && ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) <= .5);
    const still = !gone && placed.every(x => near(x.then, x.now));
    const carry = !still && !gone && live.length === 1 && placed.length === 1 && live[0].then?.w > 0 && live[0].then.h > 0 && live[0].now;
    const map = carry ? ((a, b) => ([x, y]) => [b.x + (x - a.x) * b.w / a.w, b.y + (y - a.y) * b.h / a.h])(live[0].then, live[0].now) : null;
    if (s.kind === 'point') {
      const shapes = live.map(ofTarget), [dx, dy] = still ? [s.x, s.y] : map ? map([s.x, s.y]) : [];
      const dot = dx != null ? {x: dx, y: dy} : shapes[0].kind === 'rect' ? {x: shapes[0].x + shapes[0].w / 2, y: shapes[0].y + shapes[0].h / 2} : null;
      return {shapes, dot, badge: {x: Math.min(...shapes.map(r => r.x)), y: Math.min(...shapes.map(r => r.y))}, note, gone: false, glitter: false};
    }
    if (still) return drawn;
    if (map) {
      const a = live[0].then, b = live[0].now, k = Math.sqrt((b.w / a.w) * (b.h / a.h));
      const carry = s => s.kind === 'rect' ? (([x0, y0], [x1, y1]) => ({kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0}))(map([s.x, s.y]), map([s.x + s.w, s.y + s.h]))
        : s.kind === 'swath' ? {kind: 'swath', width: s.width * k, points: s.points.map(map)} : {kind: 'path', points: s.points.map(map), ...(s.rings ? {rings: s.rings.map(r => r.map(map))} : {})};
      const moved = carry(s), raw = rawSweep(m);
      return {shapes: drawnShapes(moved), dot: null, badge: topLeft(moved), note, gone: false, glitter, raw: raw && carry(raw)};
    }
    const shapes = live.map(ofTarget);
    return {shapes, dot: null, badge: {x: Math.min(...shapes.map(r => r.x)), y: Math.min(...shapes.map(r => r.y))}, note, gone: false, glitter};
  }
  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(t => { this.frame = 0; this.draw(undefined, t); });
  }
  // The glitter's colours, from the tokens (pointing.css --wand-*): the mark red, a pale and a sparkle tone; plain ink-2
  // for a mark whose targets are all gone.
  tones(gone = false) {
    const key = `${document.documentElement.dataset.appearance || ''}|${document.documentElement.dataset.theme || ''}|${gone}`;
    if (this.toneKey === key) return this.toneCache;
    const probe = document.createElement('span'); probe.style.display = 'none'; this.bar.append(probe);
    const read = name => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
    const t = gone ? [read('--ink-2'), read('--ink-2'), read('--ink-2'), read('--ink-2')] : [read('--wand-ink'), read('--wand-ink'), read('--wand-pale'), read('--wand-star')];
    probe.remove();
    this.toneKey = key; this.toneCache = t;
    return t;
  }
  // A committed wand mark as a canvas in world units: its swath (or, snapped, its outline filled), drawn at the zoom
  // of the moment with the flecks' sites on the board, so it lines up exactly with what the sheet drew while casting.
  glitterCanvas(m, g, v, o, cache = new Map()) {
    const zoom = v.zoom, dpr = devicePixelRatio || 1, tones = this.tones(g.gone);
    const key = `${m.id || m.n}|${zoom.toFixed(4)}|${dpr}|${tones.join()}|${JSON.stringify(g.shapes)}|${g.raw ? JSON.stringify(g.raw) : ''}`;
    let c = cache.get(key);
    if (!c) {
      const cell = WAND.pitch / zoom;
      const fields = g.shapes.map(s => s.kind === 'swath' ? SwathField.fromShape(s, cell) : SwathField.fromRegion(s.kind === 'outline' ? {kind: 'rect', x: s.x, y: s.y, w: s.w, h: s.h} : s, cell, 7 / zoom));
      // Snapped: the sweep as made, faint, under the outline it snapped to (the crop draws the same).
      const faint = g.raw ? SwathField.fromShape(g.raw, cell) : null;
      const boxes = [...fields, ...(faint ? [faint] : [])].map(f => f.bounds()).filter(Boolean); if (!boxes.length) return null;
      const pad = (3 * fleckSize(dpr) / dpr + 2) / zoom;
      const b0 = boundsOf(boxes.flatMap(b => [[b.x, b.y], [b.x + b.w, b.y + b.h]])), b = {x: b0.x - pad, y: b0.y - pad, w: b0.w + 2 * pad, h: b0.h + 2 * pad};
      const k = Math.min(zoom * dpr, 4096 / Math.max(b.w, b.h));
      c = document.createElement('canvas'); c.className = `pointing-swath${g.gone ? ' pointing-gone' : ''}`; c.dataset.key = key; c.dataset.n = m.n;
      c.width = Math.max(1, Math.ceil(b.w * k)); c.height = Math.max(1, Math.ceil(b.h * k));
      const ctx = c.getContext('2d');
      if (faint) { ctx.globalAlpha = FAINT; paintField(ctx, faint, {ox: b.x, oy: b.y, k}, {tones, dpr: k / zoom, size: 2, rim: 0.7}); ctx.globalAlpha = 1; }
      for (const f of fields) paintField(ctx, f, {ox: b.x, oy: b.y, k}, {tones, dpr: k / zoom, size: 2, rim: 0.7});
      c.box = b;
    }
    Object.assign(c.style, {left: `${c.box.x + o.x}px`, top: `${c.box.y + o.y}px`, width: `${c.box.w}px`, height: `${c.box.h}px`});
    return c;
  }
  // What the live gesture points at now, with snapping: cached per gesture step, since the frame and the press both ask.
  preview(g) {
    if (g.previewAt === g.version && g.previewRaw === this.raw) return g.preview;
    let hits = null, size = 0;
    if (g.tool === 'marquee' && g.current) {
      const a = g.start, b = g.current, r = {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y)};
      hits = rectHits(r, g.list); size = r.w * r.h;
    } else if (g.tool === 'lasso' && g.points.length > 2) {
      const pts = g.points.length > 600 ? simplify(g.points, 1 / this.view().zoom, 400) : g.points;
      hits = pathHits(pts, g.list); size = polygonArea(pts);
    } else if (g.tool === 'wand' && g.field) { hits = areaHits(g.field, g.list); size = g.field.area(); }
    g.preview = hits ? this.resolve(g.tool, hits, size, this.raw, g.tool === 'wand' ? g.field : null) : null;
    g.previewAt = g.version; g.previewRaw = this.raw;
    return g.preview;
  }
  // The live gesture, on the sheet, in screen pixels: a box or a free shape, or the wand's glitter, with what it points
  // at outlined (the snapped outline, solid, when it will snap; else each thing, a part dashed); the wand's ring and
  // sparkles. With nothing left to settle, no frame is drawn.
  draw(v, now = performance.now()) {
    const ctx = this.ctx; if (!ctx || !this.sheetRect) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.sheet.width, this.sheet.height);
    if (!this.active) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const red = this.red ||= getComputedStyle(this.bar).getPropertyValue('--mark-red').trim() || '#B33830';
    const g = this.gesture, r = this.sheetRect;
    let more = false;
    const outline = (c, view, dashed) => {
      const [x, y] = this.toScreen(c.x, c.y, view); ctx.save(); ctx.strokeStyle = red; ctx.lineWidth = dashed ? 1 : 2; if (dashed) ctx.setLineDash([4, 3]);
      ctx.strokeRect(x - 3, y - 3, c.w * view.zoom + 6, c.h * view.zoom + 6); ctx.restore();
    };
    // The outline it will snap to: solid, a little outside the thing, with its corners marked.
    const snapped = (s, view) => {
      ctx.save(); ctx.strokeStyle = red; ctx.lineWidth = 2;
      if (s.kind === 'rect') {
        const [x, y] = this.toScreen(s.x, s.y, view), w = s.w * view.zoom + 8, h = s.h * view.zoom + 8, X = x - 4, Y = y - 4, t = Math.min(12, w / 3, h / 3);
        ctx.strokeRect(X, Y, w, h);
        ctx.lineWidth = 4; ctx.beginPath();
        for (const [cx, cy, dx, dy] of [[X, Y, 1, 1], [X + w, Y, -1, 1], [X + w, Y + h, -1, -1], [X, Y + h, 1, -1]]) { ctx.moveTo(cx + dx * t, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * t); }
        ctx.stroke();
      } else {
        // Several things: each one's outline (the path's loops), never the bridges between them.
        ctx.beginPath();
        for (const loop of ringsOf(s)) { loop.forEach(([px, py], i) => { const [sx, sy] = this.toScreen(px, py, view); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.closePath(); }
        ctx.stroke();
      }
      ctx.restore();
    };
    const fill = () => { ctx.fillStyle = red; ctx.globalAlpha = .07; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = red; ctx.lineWidth = 1.5; ctx.stroke(); };
    if (g && !g.pan && g.moved && (g.tool === 'marquee' || g.tool === 'lasso')) {
      v ||= this.view();
      ctx.beginPath();
      if (g.tool === 'marquee' && g.current) {
        const [x0, y0] = this.toScreen(g.start.x, g.start.y, v), [x1, y1] = this.toScreen(g.current.x, g.current.y, v);
        ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); fill();
      } else if (g.tool === 'lasso') {
        g.points.forEach(([x, y], i) => { const [sx, sy] = this.toScreen(x, y, v); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
        ctx.closePath(); fill();
      }
    }
    if (g && !g.pan && g.tool === 'wand' && g.field) { v ||= this.view(); this.drawField(g.field, v, now); more = true; }
    // A snapped wand mark just committed: what the user swept dissolves while the glitter settles into the snapped outline.
    if (this.settle) {
      const p = (now - this.settle.t0) / 220;
      if (p >= 1 || this.settle.place !== this.here()) this.settle = null;
      else { v ||= this.view(); ctx.setTransform(1, 0, 0, 1, 0, 0); paintField(ctx, this.settle.field, this.sheetView(v), {tones: this.tones(), dpr: this.dpr, size: 2 * (1 - p), rim: 0.7 * (1 - p)}); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); more = true; }
    }
    if (g && !g.pan && g.moved && ['marquee', 'lasso', 'wand'].includes(g.tool)) {
      const got = this.preview(g);
      if (got?.snap) snapped(got.snap.shape, v ||= this.view());
      else for (const h of got?.hits.targets || []) if (!h.candidate.reader) outline(h.candidate, v ||= this.view(), !h.whole);
    }
    // At rest: what a click would point at, dashed (the element inside a live card or the item, else the card).
    if (!g && this.tool !== 'wand') {
      const s = this.hoverSnap?.shape;
      if (s) { v ||= this.view(); const b = s.kind === 'rect' ? s : boundsOf(outlinePointsOf(s)); outline(b, v, true); }
      else if (this.hover && !this.hover.reader) { v ||= this.view(); outline(this.hover, v, true); }
    }
    if (this.tool === 'wand') more = this.drawTip(now) || more;
    // Settling needs frames of its own only while the user holds still: a frame requested from a frame while the user moves holds
    // the user's next move back a frame (measured in round 1: 32 ms against 17 ms), so moves drive the frames then.
    if (more && (this.settle || this.sparks.length || (g?.field && now - (this.lastMove || 0) < FRESH + 40))) {
      if (g && performance.now() - (this.lastMove || 0) < 50) { clearTimeout(this.fadeTimer); this.fadeTimer = setTimeout(() => this.schedule(), 60); }
      else this.schedule();
    }
  }
  // Board units -> the sheet's device pixels, as paintField takes it.
  sheetView(v) { const r = this.sheetRect; return {ox: -v.ox - (v.left - r.left) / v.zoom, oy: -v.oy - (v.top - r.top) / v.zoom, k: v.zoom * this.dpr}; }
  // The wand's area while casting: settled flecks are kept on a canvas of their own and only the cells that changed
  // are drawn again; cells swept in the last moments sparkle over them and settle as they age.
  drawField(f, v, now) {
    const dpr = this.dpr, ctx = this.ctx, view = this.sheetView(v);
    let acc = this.acc;
    if (!acc || acc.width !== this.sheet.width || acc.height !== this.sheet.height) { acc = this.acc = document.createElement('canvas'); acc.width = this.sheet.width; acc.height = this.sheet.height; this.accFor = null; }
    const a = acc.getContext('2d'), stamp = `${view.ox}|${view.oy}|${view.k}`, tones = this.tones();
    if (this.accFor !== f || this.accView !== stamp) {
      a.clearRect(0, 0, acc.width, acc.height); f.takeDirty();
      paintField(a, f, view, {tones, dpr, size: 2, rim: 0.7});
      this.accFor = f; this.accView = stamp;
    } else {
      const d = f.takeDirty();
      if (d) {
        // Redraw the changed cells and their neighbours (a sparkle's arms and the rim reach one cell over).
        const w = {i0: d.i0 - 2, j0: d.j0 - 2, i1: d.i1 + 2, j1: d.j1 + 2}, c = f.cell;
        const x0 = Math.floor((w.i0 * c - view.ox) * view.k), y0 = Math.floor((w.j0 * c - view.oy) * view.k);
        const x1 = Math.ceil(((w.i1 + 1) * c - view.ox) * view.k), y1 = Math.ceil(((w.j1 + 1) * c - view.oy) * view.k);
        a.save(); a.beginPath(); a.rect(x0, y0, x1 - x0, y1 - y0); a.clip(); a.clearRect(x0, y0, x1 - x0, y1 - y0);
        paintField(a, f, view, {tones, dpr, size: 2, rim: 0.7, w: {i0: w.i0 - 2, j0: w.j0 - 2, i1: w.i1 + 2, j1: w.j1 + 2}});
        a.restore();
        (this.recent ||= []).push({w, t: now});
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(acc, 0, 0);
    // Fresh cells: denser and with more sparkles, for FRESH ms after they were swept.
    this.recent = (this.recent || []).filter(x => now - x.t < FRESH);
    if (this.recent.length) {
      const w = this.recent.reduce((u, {w}) => ({i0: Math.min(u.i0, w.i0), j0: Math.min(u.j0, w.j0), i1: Math.max(u.i1, w.i1), j1: Math.max(u.j1, w.j1)}), {i0: Infinity, j0: Infinity, i1: -Infinity, j1: -Infinity});
      paintField(ctx, f, view, {tones, dpr, size: 2, w, fresh: {now, ms: FRESH, only: true}});
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // The wand's tip: a ring of flecks the band's width across (how wide it casts, as an image editor shows its brush),
  // a sparkle at the point, and the sparkles it sheds. Returns whether any sparkle is still to settle.
  drawTip(now) {
    const ctx = this.ctx, r = this.sheetRect, dpr = this.dpr, red = this.tones()[0], star = this.tones()[2];
    const u = fleckSize(dpr) / dpr;
    this.sparks = this.sparks.filter(s => now - s[2] < s[3]);
    ctx.fillStyle = red; ctx.beginPath();
    const sq = (x, y, k = 1) => { const s = u * k; ctx.rect(Math.round((x - s / 2) * dpr) / dpr, Math.round((y - s / 2) * dpr) / dpr, s, s); };
    for (const [x, y, born, life, kind] of this.sparks) { const k = 1 - (now - born) / life; if (kind < 0.3 && k > 0.5) { sq(x - u, y); sq(x + u, y); sq(x, y - u); sq(x, y + u); } sq(x, y, k > 0.6 ? 1 : 0.75); }
    if (this.pointer && !this.gesture) {
      const px = this.pointer.x - r.left, py = this.pointer.y - r.top, rad = this.wandWidth / 2, n = Math.max(20, Math.round(rad * 0.9));
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; sq(px + rad * Math.cos(a), py + rad * Math.sin(a)); }
    }
    ctx.fill();
    if (this.pointer) {
      const px = this.pointer.x - r.left, py = this.pointer.y - r.top;
      ctx.fillStyle = star; ctx.beginPath(); sq(px, py, 1.5); sq(px - 1.5 * u, py); sq(px + 1.5 * u, py); sq(px, py - 1.5 * u); sq(px, py + 1.5 * u); ctx.fill();
    }
    return this.sparks.length > 0;
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
  // Send never makes the user's wait: the message is taken out of the composer at once, so the user can write the next one while
  // the server renders its crops (1–3 s). Messages go one at a time, in order. A quiet line on the bar says what is
  // in flight; a message that fails comes back into the composer, words, chips and marks, with the reason.
  send() {
    const {parts, marks} = this.message();
    if (!marks.length && !parts.some(p => p.text?.trim())) { this.focusField(); return null; }
    const board = this.board, snap = board.snapshot, boardId = snap.id;
    // A mark made inside an item says which (the sent card is read later, out of the item).
    const label = m => `${m.n} ${clip(m.where && !m.targets[0]?.whole ? `${m.label} in ${m.where}` : m.label, 60)}`;
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
    // what the user pointed at.
    // A click's mark is the whole thing outlined: the pin goes at that outline's top-right, not on the spot clicked.
    // A mark made inside an item pins the thread to that item's card (its top-right corner).
    const drawn = first && (first.shape.kind === 'point' || first.place) ? this.geometry(first, true).shapes : [];
    const vp = this.viewport.getBoundingClientRect(), centre = () => this.toBoard(vp.left + vp.width / 2, vp.top + vp.height / 2, this.boardView());
    const anchorPoint = drawn.length ? pinPointOf({kind: 'path', points: drawn.flatMap(outlinePoints)})
      : first && !first.place ? pinPointOf(first.snap?.shape || first.shape) : centre();
    const t0 = first?.targets[0];
    const anchor = pointAnchorAt(anchorPoint, snap, t0?.kind === 'placement' ? {placementId: t0.id} : t0?.kind === 'decoration' ? {decorationId: t0.id} : {});
    if (anchor.relative) anchor.relative = {x: Math.min(1, Math.max(0, anchor.relative.x)), y: Math.min(1, Math.max(0, anchor.relative.y))};
    else { delete anchor.placementId; delete anchor.decorationId; }
    const appearance = document.documentElement.dataset.appearance === 'dark' ? 'dark' : 'light';
    const pointing = {
      v: 1, source: 'typed', startedAt: this.startedAt || new Date().toISOString(), sentAt: new Date().toISOString(), appearance,
      parts,
      marks: marks.map(m => ({n: m.n, tool: m.tool, ...(m.via ? {via: m.via} : {}), at: m.at, end: m.end, boardId: m.boardId, ...(m.place ? {place: m.place} : {}), shape: m.shape, ...(m.snap ? {snap: m.snap} : {}), targets: m.targets, crop: null})),
    };
    const fb = board.feedback?.actor, author = fb?.id ? {id: fb.id, label: fb.label || 'You', kind: 'human'} : {id: 'human-local', label: 'You', kind: 'human'};
    const job = {draft: this.takeDraft(), operation: {boardId, author, body, to: {kind: 'agent'}, status: 'sent', ...(refs.length ? {refs} : {}), anchor, pointing}, count: marks.length,
      pictures: new Map(marks.filter(m => m.picture).map(m => [m.n, m.picture]))};
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
        // Inside an opened image: the picture's own file, cut round what the user pointed at (image px), with the user's mark.
        if (m.place?.kind === 'item') {
          const file = job.pictures?.get(m.n); if (!file) continue;
          await new Promise(r => setTimeout(r));
          const crop = await imageFileCrop(file, m.snap?.shape || m.shape, {gesture: m.shape, swath: m.tool === 'wand' ? (ctx, toCrop, k) => this.cropSwath(ctx, toCrop, k, m) : null, red: this.tones()[0]}).catch(() => null);
          if (crop) m.crop = {dataUrl: crop.dataUrl, from: `the opened image's own file, cropped in the browser: ${crop.from}`.slice(0, 600)};
          continue;
        }
        const t = m.targets.length === 1 && m.targets[0].kind === 'placement' && m.targets[0].itemKind === 'image' ? m.targets[0] : null;
        if (!t || m.boardId !== board.snapshot.id) continue;
        await new Promise(r => setTimeout(r)); // one crop per task, so typing is never held up
        const card = this.world.querySelector(`.workspace-card[data-placement="${CSS.escape(t.id)}"]`);
        const p = board.snapshot.placements.find(x => x.id === t.id), item = p && board.snapshot.items?.[p.itemId];
        const file = item?.content?.kind === 'image' ? resourceURL(item.content.resource) : null;
        const crop = card ? await imageCropFull(card, t.whole ? undefined : t.region, file, m.tool === 'wand' ? this.cropGlitter(m) : null).catch(() => null) : null;
        if (crop) m.crop = {dataUrl: crop.dataUrl, from: `the image item's own file, cropped in the browser: ${crop.from.replace(/^image file,?\s*/, '')}${m.tool === 'wand' ? '; the wand\'s area drawn over it as red flecks' : ''}`.slice(0, 600)};
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
  // A wand mark made inside an opened image, as glitter on its crop (`toCrop` image px -> crop px, `k` crop px per image px).
  cropSwath(ctx, toCrop, k, m) {
    const s = m.snap?.shape || m.shape, [ox, oy] = toCrop(0, 0), cell = Math.max(1, WAND.pitch / k);
    const field = s.kind === 'swath' ? SwathField.fromShape(s, cell) : SwathField.fromRegion(s, cell, 7 / k), view = {ox: -ox / k, oy: -oy / k, k};
    const raw = rawSweep(m);
    if (raw) { ctx.save(); ctx.globalAlpha = FAINT; paintField(ctx, SwathField.fromShape(raw, cell), view, {tones: this.tones(), dpr: 1, size: 2, rim: 0.7}); ctx.restore(); }
    paintField(ctx, field, view, {tones: this.tones(), dpr: 1, size: 2, rim: 0.7});
  }
  // A wand mark's glitter over its image crop: the same area (the snapped outline filled, or the swath) at the same
  // density as on the board, scaled with the crop.
  cropGlitter(m) {
    return (ctx, toCrop) => {
      const v = this.view(), scr = (x, y) => [v.left + (x + v.ox) * v.zoom, v.top + (y + v.oy) * v.zoom];
      const [ax, ay] = toCrop(...scr(0, 0)), [bx] = toCrop(...scr(1, 0)), k = bx - ax; if (!(k > 0)) return;
      const view = {ox: -ax / k, oy: -ay / k, k}, cell = WAND.pitch / v.zoom, s = m.snap?.shape || m.shape;
      const field = s.kind === 'swath' ? SwathField.fromShape(s, cell) : SwathField.fromRegion(s, cell, 7 / v.zoom), raw = rawSweep(m);
      if (raw) { ctx.save(); ctx.globalAlpha = FAINT; paintField(ctx, SwathField.fromShape(raw, cell), view, {tones: this.tones(), dpr: Math.max(1, k / v.zoom), size: 2, rim: 0.7}); ctx.restore(); }
      paintField(ctx, field, view, {tones: this.tones(), dpr: Math.max(1, k / v.zoom), size: 2, rim: 0.7});
    };
  }
  // The composer's content as it stands, to send and, if sending fails, to give back.
  takeDraft() {
    return {nodes: [...this.field.childNodes].map(n => n.cloneNode(true)), marks: new Map(this.marks), words: new Map(this.words.times),
      t0: this.t0, startedAt: this.startedAt};
  }
  // A message that did not go: back in the composer. If the user has started the next one, the old one goes before it on
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
    // Plain reasons: the app not answering, or what the server said (lib/feedback.mjs words its refusals for the user's).
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
    this.marks = new Map(); this.t0 = null; this.startedAt = null; this.words = new TypedWords(); this.wandLast = null;
    this.renderMarks();
    this.saveSoon();
  }
  // A line on the bar that explains why something was not taken (the mark limit, a message too long, nothing
  // selected); it goes at the user's next keystroke or mark.
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
    // Messages that were still sending as the user left: the server has them, or they come back, before the user's draft.
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
    for (const el of this.layer.querySelectorAll('.pointing-shape:not(.pointing-outline), .pointing-swath, .pointing-badge, .pointing-dot')) {
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
    const g = this.geometry(m, false); if (!g.shapes.length && !g.dot) return false;
    const b = g.shapes.length ? boundsOf(g.shapes.flatMap(outlinePoints))
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
    // The opened item's top bar has the same key (first among its actions); pressed while on, it leaves.
    const bar = document.querySelector('#reader-header .chrome-actions');
    if (bar && !bar.querySelector('[data-pointing-enter]')) {
      const key = document.createElement('button');
      key.type = 'button'; key.className = 'tk-btn tk-icon reader-pointing'; key.dataset.pointingEnter = '';
      key.setAttribute('aria-label', 'Point and type'); key.setAttribute('aria-keyshortcuts', 'P'); key.setAttribute('aria-pressed', 'false'); key.dataset.tip = 'Point and type';
      key.innerHTML = ICON.enter;
      bar.prepend(key);
      key.addEventListener('click', () => { if (this.active) this.leave(); else this.enter(); });
      tips(key);
      this.readerKey = key;
    }
  }
}

// A proposal from inside one card is what the user means over the whole card when the user's gesture lies inside the card (80 % of
// its bounds) and what it found is clearly smaller than the card (under 60 % of its area).
function inCard(p, geom) {
  const c = p.candidate; if (!c || !geom) return false;
  const card = {x: c.x, y: c.y, w: c.w, h: c.h}, cardArea = card.w * card.h; if (!(cardArea > 0)) return false;
  const s = p.shape.kind === 'rect' ? p.shape : boundsOf(outlinePointsOf(p.shape));
  if (s.w * s.h >= 0.6 * cardArea) return false;
  const g = geom.kind === 'point' ? {x: geom.x, y: geom.y, w: 0, h: 0} : geom.kind === 'rect' ? geom
    : boundsOf(geom.kind === 'swath' ? geom.points.flatMap(([x, y]) => [[x - geom.width / 2, y - geom.width / 2], [x + geom.width / 2, y + geom.width / 2]]) : geom.points);
  if (!(g.w * g.h > 0)) return g.x >= card.x && g.x <= card.x + card.w && g.y >= card.y && g.y <= card.y + card.h;
  const i = intersectRect(g, card);
  return !!i && i.w * i.h >= 0.8 * g.w * g.h;
}
// The direction a stroke was travelling as it ended (a unit vector, screen and board alike), over its last `span`
// units of line; null for a stroke too short to say.
function travel(points, span) {
  const n = points.length; if (n < 2) return null;
  const [x1, y1] = points[n - 1]; let k = n - 2;
  while (k > 0 && Math.hypot(x1 - points[k][0], y1 - points[k][1]) < span) k--;
  const dx = x1 - points[k][0], dy = y1 - points[k][1], l = Math.hypot(dx, dy);
  return l > 1e-6 ? [dx / l, dy / l] : null;
}
// One flat pass along a line: no taller than half its band (or a quarter of its length), at least a band long, and
// not doubling back on itself (its length at most 1.35 × its width). An underline, or a stroke through a line of words.
export function flatStroke(points, width) {
  if (!points?.length) return false;
  const b = boundsOf(points); let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return b.w >= width && b.h <= Math.max(0.5 * width, 0.25 * b.w) && len <= 1.35 * b.w;
}
const growBox = (b, d) => ({x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d});
// A placement's or drawn element's saved box (board units), as the server stores `placed`; null when it has none.
const dataBox = o => o && [o.x, o.y, o.width, o.height].every(Number.isFinite) ? {x: o.x, y: o.y, w: o.width, h: o.height} : null;
// Where a mark's number sits for a shape as drawn: its top-left corner, or a path's topmost point.
const labelOf = (targets, more, empty) => targets.length === 0 ? empty : targets.length === 1 && !more ? targets[0].title : `${targets.length + more} items`;
// A shape's outline as points in board units: a rect's corners, a path's points, a swath's band (its points' boxes).
function outlinePoints(s) {
  if (s.kind === 'rect' || s.kind === 'outline') return [[s.x, s.y], [s.x + s.w, s.y + s.h]];
  if (s.kind === 'swath') { const r = s.width / 2; return s.points.flatMap(([x, y]) => [[x - r, y - r], [x + r, y + r]]); }
  if (s.kind === 'point') return [[s.x, s.y]];
  return outlinePointsOf(s);
}
// A snapped wand mark's sweep as the user made it, drawn faint under the snapped outline (as the crop draws it).
const rawSweep = m => m.tool === 'wand' && m.snap && m.shape.kind === 'swath' ? m.shape : null;
function topLeft(s) {
  if (s.kind === 'rect') return {x: s.x, y: s.y};
  if (s.kind === 'swath') { const top = s.points.reduce((a, p) => p[1] < a[1] ? p : a); return {x: top[0] - s.width * 0.35, y: top[1] - s.width / 2}; }
  if (s.rings?.length > 1) { const b = boundsOf(outlinePointsOf(s)); return {x: b.x, y: b.y}; } // several outlines: their corner
  const top = s.points.reduce((a, p) => p[1] < a[1] ? p : a); return {x: top[0], y: top[1]};
}
function pinPointOf(s) {
  if (s.kind === 'point') return {x: s.x, y: s.y};
  const b = s.kind === 'rect' ? s : boundsOf(outlinePoints(s)); return {x: b.x + b.w, y: b.y};
}
/** A mark in words, for the chip's hint and the live region. */
export function describe(mark) {
  const t = mark.targets;
  // Made inside an opened item: what in it, and which item (and version).
  if (mark.place?.kind === 'item') {
    const where = mark.where || t[0]?.title || 'the opened item';
    if (t[0]?.whole) return `${where}, as shown in the opened item`;
    if (!t.length) return `${mark.label || 'Outside the item'}: nothing in ${where}`;
    const what = mark.snap ? `the ${mark.snap.label}` : t[0]?.text?.quote ? `"${t[0].text.quote.length > 60 ? t[0].text.quote.slice(0, 59) + '…' : t[0].text.quote}"` : mark.label ? mark.label : mark.shape.kind === 'point' ? 'a point' : 'an area';
    return `${what[0].toUpperCase()}${what.slice(1)}, inside ${where}${mark.note ? `. ${mark.note}` : ''}`;
  }
  if (!t.length) return mark.shape.kind === 'point' ? 'A point on the board' : 'An empty area of the board';
  const snapped = mark.snap ? `, snapped to the ${mark.snap.label.replace(/^\d+ objects$/, 'objects')}` : '';
  if (t.length === 1 && !mark.more) return `${t[0].whole ? '' : 'Part of '}${t[0].title}${snapped}`;
  const names = t.slice(0, 3).map(x => x.title).join(', ');
  return `${t.length + (mark.more || 0)} items: ${names}${t.length > 3 || mark.more ? ', …' : ''}${snapped}`;
}
